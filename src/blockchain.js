import CryptoJS from 'crypto-js';
import _ from 'lodash';
import Sizeof from 'object-sizeof';
import {broadcastLatest, broadCastTransactionPool} from './p2p';
import {
  getCoinbaseTransaction, isValidAddress, processTransactions, 
  Transaction, TxOut, UnspentTxOut 
} from './transaction';
import {addToTransactionPool, getTransactionPool, updateTransactionPool} from './transactionPool';
import {hexToBinary} from './util';
import {
  createTransaction, findUnspentTxOuts, getBalance, getPrivateFromWallet, 
  getPublicFromWallet, getPubkeyHashFromWallet
} from './wallet';

class Block {
  constructor(blocksize, header, transactions) {
    this.magicNo = 'D9B4BEF9';
    this.blocksize = blocksize;
    this.header = header;
    this.transactionCounter = transactions.length;
    this.transactions = transactions;
  }
}

class BlockHeader {
  constructor(previousHash, hashMerkleRoot, time, bits, nonce) {
    this.version = '01000000';
    this.previousHash = previousHash;
    this.hashMerkleRoot = hashMerkleRoot;
    this.time = time;
    this.bits = bits;
    this.nonce = nonce;
  }
}

const genesisTransaction = new Transaction(
  [],
  [new TxOut(
    5000000000, 
    '00bb445596938cc933915563c530930da2d2e25d60ad0b2883'
  )],
  '495F48B9'
);

const genesisBlock = new Block(
  '011D0000',
  new BlockHeader(
    '0000000000000000000000000000000000000000000000000000000000000000',
    '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
    '495F48B9',
    '1F00FFFF',
    '7C2BAC1D'
  ),
  [genesisTransaction]
);

let blockchain = [genesisBlock];

// the unspent txOut of genesis block is set to unspentTxOuts on startup
let unspentTxOuts;

const getBlockchain = () => blockchain;

const getUnspentTxOuts = () => _.cloneDeep(unspentTxOuts);

// and txPool should be only updated at the same time
const setUnspentTxOuts = (newUnspentTxOut) => {
  console.log('replacing unspentTxouts with: %s', newUnspentTxOut);
  console.log(newUnspentTxOut)
  unspentTxOuts = newUnspentTxOut;
};

const getLatestBlock = () => blockchain[blockchain.length - 1];

// in seconds
const BLOCK_GENERATION_INTERVAL = 10;

// in blocks
const DIFFICULTY_ADJUSTMENT_INTERVAL = 10;

const calculateTargetFromBits = (bits) => {
  const exp = Number("0x" + bits.substr(0,2));
  const coe = Number("0x" + bits.substr(2));
  return (coe * 2**(8*(exp - 3))).toString(16);
}

const calculateDifficultyFromBits = (bits) => {
  return 0x00000000FFFF0000000000000000000000000000000000000000000000000000 / Number("0x" + calculateTargetFromBits(bits))
}

const calculateBlockHash = (header) => {
  const concatedStr = Object.keys(header).reduce( (ac, cu, i) => i === 1 ? header[ac] + header[cu] : ac + header[cu] );
  return CryptoJS.SHA256(CryptoJS.SHA256(concatedStr)).toString();
}

const calculateTxHash = (tx) => {
  const concatedStr = Object.keys(tx)
    .map((key) => {
      if (key === 'txIns') {
        return tx.txIns.length === 0
          ? ""
          : tx.txIns.map(txIn => txIn.previousTx + txIn.index + txIn.scriptSig).reduce((ac, cu) => ac + cu);
      } else if (key === 'txOuts') {
        return tx.txOuts.length === 0
          ? ""
          : tx.txOuts.map(txOut => txOut.value + txOut.scriptPubKey).reduce((ac, cu) => ac + cu);
      }
      return tx[key];
    })
    .reduce((ac, cu) => ac + cu);
  return CryptoJS.SHA256(CryptoJS.SHA256(concatedStr)).toString();
} 

const calculateMerkeRoot = (txs) => {
  const concatedStr = txs
    .map((tx) => calculateTxHash(tx))
    .reduce((ac, cu) => ac + cu);
  return CryptoJS.SHA256(CryptoJS.SHA256(concatedStr)).toString();
}

const getBits = (aBlockchain) => {
  const latestBlock = aBlockchain[blockchain.length - 1];
  const currentTarget = calculateTargetFromBits(latestBlock.header.bits);
  if (aBlockchain.length % (DIFFICULTY_ADJUSTMENT_INTERVAL + 1) === 0) {
    const now = (new Date()).getTime
    const old = (aBlockchain[blockchain.length - 1 - DIFFICULTY_ADJUSTMENT_INTERVAL].BlockHeader.time) * 1000;
    const time = now - old;
    return getAdjustedBits(currentTarget, time);
  } else {
    return latestBlock.header.bits;
  }
};

const getAdjustedBits = (currentTarget, time) => {
  const newTarget = (Number("0x" + currentTarget) * time / (BLOCK_GENERATION_INTERVAL * DIFFICULTY_ADJUSTMENT_INTERVAL)).toString(16);
  const exp =  (Math.ceil(newTarget.length/2)).toString(16);
  const coe = newTarget.substr(0,6);
  return exp + coe;
};

// const getCurrentTimestamp = () => Math.round(new Date().getTime() / 1000);
const getCurrentTimestamp = () => Math.floor((new Date()).getTime()/1000).toString(16);

const replaceLockTime = (txs, lockTime) => {
  return txs.map(tx => {
    tx.lockTime = lockTime
    return tx;
  });
}

const generateRawNextBlock = (txs) => {
  const previousHash = calculateBlockHash(getLatestBlock().header);
  const hashMerkleRoot = calculateMerkeRoot(txs);
  const bits = getBits(getBlockchain());
  const header = findBlockHeader(previousHash, hashMerkleRoot, bits);
  const newTxs = replaceLockTime(txs, header.time);
  const blocksize = Sizeof(new Block('00000000', header, newTxs)).toString(16);
  const newBlock = new Block(blocksize, header, newTxs)
  if (addBlockToChain(newBlock)) {
    broadcastLatest();
    return newBlock;
  } else {
    return null;
  }
};

// gets the unspent transaction outputs owned by the wallet
const getMyUnspentTransactionOutputs = () => {
  return findUnspentTxOuts(getPublicFromWallet(), getUnspentTxOuts());
};

const generateNextBlock = () => {
  const coinbaseTx = getCoinbaseTransaction(getPubkeyHashFromWallet());
  const transactions = [coinbaseTx].concat(getTransactionPool());
  return generateRawNextBlock(transactions);
};

// const generatenextBlockWithTransaction = (receiverAddress, amount) => {
//   if (!isValidAddress(receiverAddress)) {
//     throw Error('invalid address');
//   }
//   if (typeof amount !== 'number') {
//     throw Error('invalid amount');
//   }
//   const coinbaseTx = getCoinbaseTransaction(getAddressFromWallet());
//   const tx = createTransaction(receiverAddress, amount, getPrivateFromWallet(), getUnspentTxOuts(), getTransactionPool());
//   const transactions = [coinbaseTx, tx];
//   return generateRawNextBlock(transactions);
// };

const findBlockHeader = (previousHash, hashMerkleRoot, bits) => {
  // const target = Number('0x' + calculateTargetFromBits(bits));
  let nonceCounter = 0x10000000;
  while (true) {
    const nonce = nonceCounter.toString(16);
    const time = getCurrentTimestamp();
    const header = new BlockHeader(previousHash, hashMerkleRoot, time, bits, nonce);
    if (hashMatchesTarget(header, bits)) return header;
    nonceCounter++;
  }
};

const getAccountBalance = () => {
  return getBalance(getPubkeyHashFromWallet(), getUnspentTxOuts());
};

const sendTransaction = (address, value) => {
  const tx = createTransaction(address, value, getUnspentTxOuts(), getTransactionPool());
  addToTransactionPool(tx, getUnspentTxOuts());
  broadCastTransactionPool();
  return tx;
};

const isValidBlockStructure = (block) => {
  return typeof block.blocksize === 'string'
    && typeof block.header === 'object'
    && typeof block.transactionCounter === 'number'
    && block.transactions instanceof Array;
};

const isValidNewBlock = (newBlock, previousBlock) => {
  if (!isValidBlockStructure(newBlock)) {
    console.log('invalid block structure: %s', JSON.stringify(newBlock));
    return false;
  }
  if (calculateBlockHash(previousBlock.header) !== newBlock.header.previousHash) {
    console.log('invalid previoushash');
    return false;
  }
  if (!hasValidHash(newBlock)) return false;
  return true;
};

const getAccumulatedDifficulty = (aBlockchain) => {
  return aBlockchain
    .map((block) => calculateDifficultyFromBits(block.bits))
    .reduce((a, b) => a + b);
};

const hasValidHash = (block) => {
  if (!hashMatchesTarget(block.header, block.header.bits)) {
    console.log('block difficulty not satisfied. Expected: ' + block.difficulty + 'got: ' + block.hash);
  }
  return true;
};

const hashMatchesTarget = (header, bits) => {
  const hash = Number('0x' + calculateBlockHash(header));
  const target = Number('0x' + calculateTargetFromBits(bits));
  return hash <= target;
};

/*
  Checks if the given blockchain is valid. Return the unspent txOuts if the chain is valid
 */
const isValidChain = (blockchainToValidate) => {
  console.log('isValidChain:');
  console.log(JSON.stringify(blockchainToValidate));
  const isValidGenesis = (block) => {
    return JSON.stringify(block) === JSON.stringify(genesisBlock);
  };

  if (!isValidGenesis(blockchainToValidate[0])) return null;

  /*
  Validate each block in the chain. The block is valid if the block structure is valid
    and the transaction are valid
   */
  let aUnspentTxOuts = [];

  for (let i = 0; i < blockchainToValidate.length; i++) {
    const currentBlock = blockchainToValidate[i];
    if (i !== 0 && !isValidNewBlock(blockchainToValidate[i], blockchainToValidate[i - 1])) return null;

    aUnspentTxOuts = processTransactions(currentBlock.transactions, aUnspentTxOuts, getBlockchain().length);
    if (aUnspentTxOuts === null) {
      console.log('invalid transactions in blockchain');
      return null;
    }
  }
  return aUnspentTxOuts;
};

const addBlockToChain = (newBlock) => {
  if (isValidNewBlock(newBlock, getLatestBlock())) {
    const retVal = processTransactions(newBlock.transactions, getUnspentTxOuts(), getBlockchain().length);
    if (retVal === null) {
      console.log('block is not valid in terms of transactions');
      return false;
    } else {
      blockchain.push(newBlock);
      setUnspentTxOuts(retVal);
      updateTransactionPool(unspentTxOuts);
      return true;
    }
  }
  return false;
};

const replaceChain = (newBlocks) => {
  const aUnspentTxOuts = isValidChain(newBlocks);
  const validChain = aUnspentTxOuts !== null;
  if (validChain &&
    getAccumulatedDifficulty(newBlocks) > getAccumulatedDifficulty(getBlockchain())) {
    console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
    blockchain = newBlocks;
    setUnspentTxOuts(aUnspentTxOuts);
    updateTransactionPool(unspentTxOuts);
    broadcastLatest();
  } else {
    console.log('Received blockchain invalid');
  }
};

const handleReceivedTransaction = (transaction) => {
  addToTransactionPool(transaction, getUnspentTxOuts());
};

export {
  Block, getBlockchain, getUnspentTxOuts, getLatestBlock, sendTransaction,
  generateRawNextBlock, generateNextBlock,
  handleReceivedTransaction, getMyUnspentTransactionOutputs,calculateTxHash,
  getAccountBalance, isValidBlockStructure, replaceChain, addBlockToChain, getCurrentTimestamp, setUnspentTxOuts
};
