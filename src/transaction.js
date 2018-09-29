import CryptoJS from 'crypto-js';
import ecdsa from 'elliptic';
import _ from 'lodash';
import {getCurrentTimestamp, calculateTxHash} from './blockchain';

const ec = new ecdsa.ec('secp256k1');

const COINBASE_AMOUNT = 5000000000;

class UnspentTxOut {
  constructor(txHash, blockHeight, txOutIndex, txOutValue, scriptPubKey) {
    this.txHash = txHash;
    this.blockHeight = blockHeight;
    this.txOutIndex = txOutIndex;
    this.txOutValue = txOutValue;
    this.scriptPubKey = scriptPubKey;
  }
}

class TxIn {
  constructor(previousTx, index, scriptSig) {
    this.previousTx = previousTx;
    this.index = index;
    this.scriptSig = scriptSig;
  }
}

class TxOut {
  constructor(value, scriptPubKey) {
    this.value = value;
    this.scriptPubKey = scriptPubKey;
  }
}

class Transaction {
  constructor(txIns, txOuts, lockTime) {
    this.versionNo = '01000000';
    this.flag = '';
    this.inCounter = txIns.length;
    this.txIns = txIns;
    this.outCounter = txOuts.length;
    this.txOuts = txOuts;
    this.witnesses = 'undefined';
    this.lockTime = lockTime;
  }
}

const validateTransaction = (transaction, aUnspentTxOuts) => {
  if (!isValidTransactionStructure(transaction)) return false;

  const hasValidTxIns = transaction.txIns
    .map((txIn) => validateTxIn(txIn, transaction, aUnspentTxOuts))
    .reduce((a, b) => a && b, true);
  if (!hasValidTxIns) {
    console.log('some of the txIns are invalid in tx: ' + transaction.id);
    return false;
  }

  const totalTxInValues = transaction.txIns
    .map((txIn) => getTxInValue(txIn, aUnspentTxOuts))
    .reduce((a, b) => (a + b), 0);

  const totalTxOutValues = transaction.txOuts
    .map((txOut) => txOut.value)
    .reduce((a, b) => (a + b), 0);

  if (totalTxOutValues !== totalTxInValues) {
    console.log('totalTxOutValues !== totalTxInValues in tx: ' + transaction.id);
    return false;
  }

  return true;
};

const validateBlockTransactions = (aTransactions, aUnspentTxOuts) => {
  const coinbaseTx = aTransactions[0];
  if (!validateCoinbaseTx(coinbaseTx)) {
    console.log('invalid coinbase transaction: ' + JSON.stringify(coinbaseTx));
    return false;
  }

  // check for duplicate txIns. Each txIn can be included only once
  const txIns = _(aTransactions)
    .map((tx) => tx.txIns)
    .flatten()
    .value();

  if (hasDuplicates(txIns)) {
    return false;
  }

  // all but coinbase transactions
  const normalTransactions = aTransactions.slice(1);
  return normalTransactions.map((tx) => validateTransaction(tx, aUnspentTxOuts))
    .reduce((a, b) => (a && b), true);
};

const hasDuplicates = (txIns) => {
  const groups = _.countBy(txIns, (txIn) => txIn.previousTx + txIn.index);
  return _(groups)
    .map((value, key) => {
      if (value > 1) {
        console.log('duplicate txIn: ' + key);
        return true;
      } else {
        return false;
      }
    })
    .includes(true);
};

const validateCoinbaseTx = (transaction) => {
  if (transaction == null) {
    console.log('the first transaction in the block must be coinbase transaction');
    return false;
  }
  if (transaction.txIns.length !== 0) {
    console.log('txIn must be empty in the coinbase transaction');
    return;
  }
  if (transaction.txOuts.length !== 1) {
    console.log('invalid number of txOuts in coinbase transaction');
    return false;
  }
  if (transaction.txOuts[0].value !== COINBASE_AMOUNT) {
    console.log('invalid coinbase value in coinbase transaction');
    return false;
  }
  return true;
};

const validateTxIn = (txIn, transaction, aUnspentTxOuts) => {

  const referencedUTxOut = aUnspentTxOuts.find((uTxO) => uTxO.txHash === txIn.previousTx && uTxO.txOutIndex === txIn.index);
  if (referencedUTxOut == null) {
    console.log('referenced txOut not found: ' + JSON.stringify(txIn));
    return false;
  }

  const scriptPubKey = referencedUTxOut.scriptPubKey;
  const verifyTxHash = calculateTxHash(
    new Transaction(
      transaction.txIns.map(txIn => new TxIn(txIn.previousTx, txIn.index, scriptPubKey)),
      transaction.txOuts,
      '00000000'
    )
  );

  const signature = txIn.scriptSig.substr(0, txIn.scriptSig.length - 130)
  const pubkey = txIn.scriptSig.substr(-130);

  const key = ec.keyFromPublic(pubkey, 'hex');
  const validSignature = key.verify(verifyTxHash, signature);
  
  if (!validSignature) {
    console.log('invalid txIn signature: %s pubkey: %s', signature, pubkey);
    return false;
  }

  return true;
};

const getTxInValue = (txIn, aUnspentTxOuts) => {
  return findUnspentTxOut(txIn.previousTx, txIn.index, aUnspentTxOuts).txOutValue;
};

const findUnspentTxOut = (previousTx, index, aUnspentTxOuts) => {
  return aUnspentTxOuts.find((uTxO) => uTxO.txHash === previousTx && uTxO.txOutIndex === index);
};

const getCoinbaseTransaction = (pubkeyHash) => {
  return new Transaction(
    [],
    [new TxOut(COINBASE_AMOUNT, pubkeyHash)],
    getCurrentTimestamp()
  );
};

const signTxIn = (transaction, txInIndex,
          privateKey, pubkeyHash, aUnspentTxOuts) => {
  const txIn = transaction.txIns[txInIndex];

  const dataToSign = calculateTxHash(transaction);
  const referencedUnspentTxOut = findUnspentTxOut(txIn.previousTx, txIn.index, aUnspentTxOuts);
  if (referencedUnspentTxOut == null) {
    console.log('could not find referenced txOut');
    throw Error();
  }
  const referencedPubkeyHash = referencedUnspentTxOut.scriptPubKey;

  if (pubkeyHash !== referencedPubkeyHash) {
    console.log('trying to sign an input with private' +
      ' key that does not match the address that is referenced in txIn');
    throw Error();
  }
  
  const key = ec.keyFromPrivate(privateKey, 'hex');
  const signature = toHexString(key.sign(dataToSign).toDER());
  const pubkey = getPublicKey(privateKey);

  return signature + pubkey;
};

const updateUnspentTxOuts = (aTransactions, aUnspentTxOuts, blockHeight) => {
  const newUnspentTxOuts = aTransactions
    .map((t) => {
      return t.txOuts.map((txOut, index) => new UnspentTxOut(calculateTxHash(t), blockHeight, index, txOut.value, txOut.scriptPubKey));
    })
    .reduce((a, b) => a.concat(b), []);

  const consumedTxOuts = aTransactions
    .map((t) => t.txIns)
    .reduce((a, b) => a.concat(b), [])
    .map((txIn) => findUnspentTxOut(txIn.previousTx, txIn.index, aUnspentTxOuts));

  const resultingUnspentTxOuts = aUnspentTxOuts
    .filter(((uTxO) => !findUnspentTxOut(uTxO.txHash, uTxO.txOutIndex, consumedTxOuts)))
    .concat(newUnspentTxOuts);

  return resultingUnspentTxOuts;
};

const processTransactions = (aTransactions, aUnspentTxOuts, blockHeight) => {
  if (!validateBlockTransactions(aTransactions, aUnspentTxOuts)) {
    console.log('invalid block transactions');
    return null;
  }
  return updateUnspentTxOuts(aTransactions, aUnspentTxOuts, blockHeight);
};

const toHexString = (byteArray) => {
  return Array.from(byteArray, (byte) => {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('');
};

const getPublicKey = (aPrivateKey) => {
  return ec.keyFromPrivate(aPrivateKey, 'hex').getPublic().encode('hex');
};

const isValidTxInStructure = (txIn) => {
  if (txIn == null) {
    console.log('txIn is null');
    return false;
  } else if (typeof txIn.previousTx !== 'string') {
    console.log('invalid previousTx type in txIn');
    return false;
  } else if (typeof txIn.index !== 'number') {
    console.log('invalid index type in txIn');
    return false;
  } else if (typeof txIn.scriptSig !== 'string') {
    console.log('invalid scriptSig type in txIn');
    return false;
  } else {
    return true;
  }
};

const isValidTxOutStructure = (txOut) => {
  if (txOut == null) {
    console.log('txOut is null');
    return false;
  } else if (typeof txOut.value !== 'number') {
    console.log('invalid value type in txOut');
    return false;
  } else if (typeof txOut.scriptPubKey !== 'string') {
    console.log('invalid scriptPubKey type in txOut');
    return false;
  } else {
    return true;
  }
};

const isValidTransactionStructure = (transaction) => {
  if (typeof transaction.versionNo !== 'string') {
    console.log('transactionId missing');
    return false;
  }
  if (!(transaction.txIns instanceof Array)) {
    console.log('invalid txIns type in transaction');
    return false;
  }
  if (!transaction.txIns
      .map(isValidTxInStructure)
      .reduce((a, b) => (a && b), true)) {
    return false;
  }
  if (!(transaction.txOuts instanceof Array)) {
    console.log('invalid txIns type in transaction');
    return false;
  }
  if (!transaction.txOuts
      .map(isValidTxOutStructure)
      .reduce((a, b) => (a && b), true)) {
    return false;
  }
  return true;
};

// valid address is a valid ecdsa public key in the 04 + X-coordinate + Y-coordinate format
const isValidAddress = (address) => {
  if (address.length !== 130) {
    console.log(address);
    console.log('invalid public key length');
    return false;
  } else if (address.match('^[a-fA-F0-9]+$') === null) {
    console.log('public key must contain only hex characters');
    return false;
  } else if (!address.startsWith('04')) {
    console.log('public key must start with 04');
    return false;
  }
  return true;
};

export {
  processTransactions, signTxIn, isValidAddress, validateTransaction,
  UnspentTxOut, TxIn, TxOut, getCoinbaseTransaction, getPublicKey, hasDuplicates,
  Transaction
};
