# Naivecoin Extention

Naivecoin is great project to understand Bitcoin.
This is extended version of it. The differences  block structure and transaction structure whose are same as actual Bitcoin.

Blog Post: [Understand Bitcoin block structure and transaction structure with NaiveCoin which is simplified Javascript Bitcoin.](https://medium.com/@t.tak/understand-bitcoin-block-structure-and-transaction-structure-with-naivecoin-which-is-simplified-7f5d441275af)

The repository for the original naivecoin tutorial: https://lhartikk.github.io/

## Getting start
```
npm install
npm start
```

##### Get blockchain
```
curl http://localhost:3001/blocks
```

##### Mine a block
```
curl -X POST http://localhost:3001/mineBlock
``` 

##### Send transaction
```
curl -H "Content-type: application/json" --data '{"address": "1KYiKJEfdJtap9QX2v9takMpz2SfU4pgZw", "value" : 1000000000}' http://localhost:3001/sendTransaction
```

##### Query transaction pool
```
curl http://localhost:3001/transactionPool
```

##### Get balance
```
curl http://localhost:3001/balance
```

#### Query information about a specific address
```
curl http://localhost:3001/address/04f72a4541275aeb4344a8b049bfe2734b49fe25c08d56918f033507b96a61f9e3c330c4fcd46d0854a712dc878b9c280abe90c788c47497e06df78b25bf60ae64
```

##### Add peer
```
curl -H "Content-type:application/json" --data '{"peer" : "ws://localhost:6001"}' http://localhost:3001/addPeer
```
#### Query connected peers
```
curl http://localhost:3001/peers
```
