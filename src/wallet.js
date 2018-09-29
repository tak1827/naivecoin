import {ec} from 'elliptic';
import CryptoJS from 'crypto-js';
import Bs58 from 'bs58';
import {existsSync, readFileSync, unlinkSync, writeFileSync} from 'fs';
import _ from 'lodash';
import {getPublicKey, getTransactionId, signTxIn, Transaction, TxIn, TxOut, UnspentTxOut} from './transaction';

const EC = new ec('secp256k1');
const privateKeyLocation = process.env.PRIVATE_KEY || 'node/wallet/private_key';

const getPrivateFromWallet = () => {
  const buffer = readFileSync(privateKeyLocation, 'utf8');
  return buffer.toString();
};

const getPublicFromWallet = () => {

  // Pub key
  const privateKey = getPrivateFromWallet();
  const key = EC.keyFromPrivate(privateKey, 'hex');
  const pubkey = key.getPublic().encode('hex');

  // Compressed pub key
  // const pubPoint = key.getPublic();
  // const x = pubPoint.getX();
  // const y = pubPoint.getY();
  // let publicKeyBytesCompressed = x.toString('hex');
  // let publicKeyHexCompressed;
  // if (y.isEven()) publicKeyHexCompressed = "0x02" + publicKeyBytesCompressed
  // else publicKeyHexCompressed = "0x03" + publicKeyBytesCompressed
  // console.log("Compressed pub key")
  // console.log(publicKeyHexCompressed);

  return pubkey;
};

const getAddressFromWallet = () => {

  // FIXME: This calculation is not correct
  const pubKey = getPublicFromWallet();
  const hash160 = CryptoJS.RIPEMD160(CryptoJS.SHA256(pubKey)).toString();
  const doubleSHA = CryptoJS.SHA256("00" + hash160).toString();
  const addressChecksum = doubleSHA.substr(0,8)
  const unencodedAddress = "00" + hash160 + addressChecksum;
  const address = Bs58.encode(Buffer.from(unencodedAddress, 'hex'));

  return address;
}

const getPubkeyHashFromWallet = () => {
  const address = getAddressFromWallet();
  const pubkeyHash = Bs58.decode(address).toString('hex');
  return pubkeyHash;
}

const getPubkeyHashFromAddress = (address) => {
  const pubkeyHash = Bs58.decode(address).toString('hex');
  return pubkeyHash;
}

const generatePrivateKey = () => {
  const keyPair = EC.genKeyPair();
  const privateKey = keyPair.getPrivate();
  return privateKey.toString(16);
};

const initWallet = () => {
  // let's not override existing private keys
  if (existsSync(privateKeyLocation)) {
    return;
  }
  const newPrivateKey = generatePrivateKey();

  writeFileSync(privateKeyLocation, newPrivateKey);
  console.log('new wallet with private key created to : %s', privateKeyLocation);
};

const deleteWallet = () => {
  if (existsSync(privateKeyLocation)) unlinkSync(privateKeyLocation);
};

const getBalance = (pubkeyHash, unspentTxOuts) => {
  return _(findUnspentTxOuts(pubkeyHash, unspentTxOuts))
    .map((uTxO) => uTxO.txOutValue)
    .sum();
};

const findUnspentTxOuts = (pubkeyHash, unspentTxOuts) => {
  return _.filter(unspentTxOuts, (uTxO) => uTxO.scriptPubKey === pubkeyHash);
};

const findTxOutsForValue = (value, myUnspentTxOuts) => {
  let currentValue = 0;
  const includedUnspentTxOuts = [];
  for (const myUnspentTxOut of myUnspentTxOuts) {
    includedUnspentTxOuts.push(myUnspentTxOut);
    currentValue = currentValue + myUnspentTxOut.txOutValue;
    if (currentValue >= value) {
      const leftOverValue = currentValue - value;
      return {includedUnspentTxOuts, leftOverValue};
    }
  }

  const eMsg = 'Cannot create transaction from the available unspent transaction outputs.' +
    ' Required value:' + value + '. Available unspentTxOuts:' + JSON.stringify(myUnspentTxOuts);
  throw Error(eMsg);
};

const createTxOuts = (receiverAddress, myPubkeyHash, value, leftOverValue) => {
  const receiverPubkeyHash = getPubkeyHashFromAddress(receiverAddress);
  const txOut1 = new TxOut(value, receiverPubkeyHash);
  if (leftOverValue === 0) {
    return [txOut1];
  } else {
    const leftOverTx = new TxOut(leftOverValue, myPubkeyHash);
    return [txOut1, leftOverTx];
  }
};

const filterTxPoolTxs = (unspentTxOuts, transactionPool) => {
  const txIns = _(transactionPool)
    .map((tx) => tx.txIns)
    .flatten()
    .value();
  const removable = [];
  for (const unspentTxOut of unspentTxOuts) {
    const txIn = _.find(txIns, (aTxIn) => {
      return aTxIn.previousTx === unspentTxOut.txHash && aTxIn.index === unspentTxOut.txOutIndex;
    });
    if (txIn !== undefined) removable.push(unspentTxOut);
  }

  return _.without(unspentTxOuts, ...removable);
};

const createTransaction = (receiverAddress, value, unspentTxOuts, txPool) => {

  console.log('txPool: %s', JSON.stringify(txPool));
  const myPubkeyHash = getPubkeyHashFromWallet();
  const myUnspentTxOutsA = unspentTxOuts.filter((uTxO) => uTxO.scriptPubKey === myPubkeyHash);
  const myUnspentTxOuts = filterTxPoolTxs(myUnspentTxOutsA, txPool);

  // filter from unspentOutputs such inputs that are referenced in pool
  const {includedUnspentTxOuts, leftOverValue} = findTxOutsForValue(value, myUnspentTxOuts);

  const toUnsignedTxIn = (unspentTxOut, pubkeyHash) => {
    const txIn = new TxIn();
    txIn.previousTx = unspentTxOut.txHash;
    txIn.index = unspentTxOut.txOutIndex;
    txIn.scriptSig = pubkeyHash;
    return txIn;
  };
  
  const unsignedTxIns = includedUnspentTxOuts.map(tx => toUnsignedTxIn(tx, myPubkeyHash));

  const tx = new Transaction(
    unsignedTxIns, 
    createTxOuts(receiverAddress, myPubkeyHash, value, leftOverValue), 
    '00000000'
  );

  tx.txIns = tx.txIns.map((txIn, index) => {
    txIn.scriptSig = signTxIn(tx, index, getPrivateFromWallet(), myPubkeyHash, unspentTxOuts);
    return txIn;
  });

  return tx;
};

export {createTransaction, getPublicFromWallet, getAddressFromWallet, getPubkeyHashFromWallet, 
  getPrivateFromWallet, getBalance, generatePrivateKey, initWallet, deleteWallet, findUnspentTxOuts};
