import bodyParser from 'body-parser';
import express from 'express';
import _ from 'lodash';
import {
  Block, generateNextBlock, generateRawNextBlock, getAccountBalance,
  getBlockchain, getMyUnspentTransactionOutputs, getUnspentTxOuts, sendTransaction, setUnspentTxOuts
} from './blockchain';
import {connectToPeers, getSockets, initP2PServer} from './p2p';
import {UnspentTxOut, processTransactions} from './transaction';
import {getTransactionPool, addToTransactionPool} from './transactionPool';
import {getPublicFromWallet, initWallet} from './wallet';

const httpPort = parseInt(process.env.HTTP_PORT) || 3001;
const p2pPort = parseInt(process.env.P2P_PORT) || 6001;

const initHttpServer = (myHttpPort) => {
  const app = express();
  app.use(bodyParser.json());

  app.use((err, req, res, next) => {
    if (err) {
      res.status(400).send(err.message);
    }
  });

  app.get('/blocks', (req, res) => {
    res.send(getBlockchain());
  });

  app.get('/block/:hash', (req, res) => {
    const block = _.find(getBlockchain(), {'hash' : req.params.hash});
    res.send(block);
  });

  app.get('/transaction/:id', (req, res) => {
    const tx = _(getBlockchain())
      .map((blocks) => blocks.data)
      .flatten()
      .find({'id': req.params.id});
    res.send(tx);
  });

  app.get('/address/:address', (req, res) => {
    const unspentTxOuts =
      _.filter(getUnspentTxOuts(), (uTxO) => uTxO.address === req.params.address);
    res.send({'unspentTxOuts': unspentTxOuts});
  });

  app.get('/unspentTransactionOutputs', (req, res) => {
    res.send(getUnspentTxOuts());
  });

  app.get('/myUnspentTransactionOutputs', (req, res) => {
    res.send(getMyUnspentTransactionOutputs());
  });

  app.post('/mineBlock', (req, res) => {
    const newBlock = generateNextBlock();
    if (newBlock === null) {
      res.status(400).send('could not generate block');
    } else {
      res.send(newBlock);
    }
  });

  app.get('/balance', (req, res) => {
    const balance = getAccountBalance();
    res.send({'balance': balance});
  });

  app.get('/address', (req, res) => {
    const address = getPublicFromWallet();
    res.send({'address': address});
  });

  app.post('/sendTransaction', (req, res) => {
    try {
      const address = req.body.address;
      const value = req.body.value;

      if (address === undefined || value === undefined) {
        throw Error('invalid address or amount');
      }
      const resp = sendTransaction(address, value);
      res.send(resp);
    } catch (e) {
      console.log(e.message);
      res.status(400).send(e.message);
    }
  });

  app.get('/transactionPool', (req, res) => {
    res.send(getTransactionPool());
  });

  app.get('/peers', (req, res) => {
    res.send(getSockets().map((s) => s._socket.remoteAddress + ':' + s._socket.remotePort));
  });
  app.post('/addPeer', (req, res) => {
    connectToPeers(req.body.peer);
    res.send();
  });

  app.post('/stop', (req, res) => {
    res.send({'msg' : 'stopping server'});
    process.exit();
  });

  app.listen(myHttpPort, () => {
    console.log('Listening http on port: ' + myHttpPort);
  });
};

initHttpServer(httpPort);
initP2PServer(p2pPort);
initWallet();
setUnspentTxOuts(processTransactions(getBlockchain()[0].transactions, [], 1));
