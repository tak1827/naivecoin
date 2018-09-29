import _ from 'lodash';
import {Transaction, TxIn, UnspentTxOut, validateTransaction} from './transaction';

let transactionPool = [];

const getTransactionPool = () => {
  return _.cloneDeep(transactionPool);
};

const addToTransactionPool = (tx, unspentTxOuts) => {
  if (!validateTransaction(tx, unspentTxOuts)) throw Error('Trying to add invalid tx to pool');

  if (!isValidTxForPool(tx, transactionPool)) throw Error('Trying to add invalid tx to pool');
  
  console.log('adding to txPool: %s', JSON.stringify(tx));
  transactionPool.push(tx);
};

const hasTxIn = (txIn  , unspentTxOuts)   => {
  const foundTxIn = unspentTxOuts.find((uTxO) => {
    return uTxO.txHash === txIn.previousTx && uTxO.txOutIndex === txIn.index;
  });
  return foundTxIn !== undefined;
};

const updateTransactionPool = (unspentTxOuts) => {
  const invalidTxs = [];
  for (const tx of transactionPool) {
    for (const txIn of tx.txIns) {
      if (!hasTxIn(txIn, unspentTxOuts)) {
        invalidTxs.push(tx);
        break;
      }
    }
  }
  if (invalidTxs.length > 0) {
    console.log('removing the following transactions from txPool: %s', JSON.stringify(invalidTxs));
    transactionPool = _.without(transactionPool, ...invalidTxs);
  }
};

const getTxPoolIns = (aTransactionPool) => {
  return _(aTransactionPool)
    .map((tx) => tx.txIns)
    .flatten()
    .value();
};

const isValidTxForPool = (tx  , aTtransactionPool)   => {
  const txPoolIns = getTxPoolIns(aTtransactionPool);

  const containsTxIn = (txIns, txIn) => {
    return _.find(txPoolIns, ((txPoolIn) => {
      return txIn.previousTx === txPoolIn.previousTx && txIn.index === txPoolIn.index;
    }));
  };

  for (const txIn of tx.txIns) {
    if (containsTxIn(txPoolIns, txIn)) {
      console.log('txIn already found in the txPool');
      return false;
    }
  }
  return true;
};

export {addToTransactionPool, getTransactionPool, updateTransactionPool};
