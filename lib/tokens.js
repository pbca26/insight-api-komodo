'use strict';

var async = require('async');
var fs = require('fs');
var bitcore = require('bitcore-lib-komodo');

var Common = require('./common');
var helpers = require('./math-helpers');

var TIP_SYNC_INTERVAL = 10;
var MEMPOOL_SYNC_INTERVAL = 2; // seconds
var RESTART_PAST_BLOCKS_LOOKUP = 5;
var isRestarted = true;

function TokensController(node) {
  this.node = node;
  this.commonCache = this.node.configPath.replace('bitcore-node.json', 'tokens-common.json');
  this.addressesIndex = this.node.configPath.replace('bitcore-node.json', 'tokens-addresses.json');
  this.processedTransactionsIndex = this.node.configPath.replace('bitcore-node.json', 'tokens-processed-transactions.json');
  this.common = new Common({log: this.node.log});
  this.cache = {
    lastBlockChecked: 0,
    processedTransactionsIndex: [],
    tokens: {},
    tokenOrders: {},
    tokenOrdersFlat: [],
  };
  this.computed = {
    addresses: [],
  };
  this.currentBlock = 0;
  this.lastBlockChecked = 0;
  this.tokensSyncInProgress = false;
  this.dataDumpInProgress = false;
  this.lastBlockProcessedTime = 0;
};

TokensController.prototype.syncTokenInfo = function(chain) {
  var self = this;

  return new Promise(function(resolve, reject) {
    self.node.services.bitcoind.tokenlist(function(err, tokenList) {
      if (!err) {
        console.log(JSON.stringify(tokenList, null, 2));
        async.eachOfSeries(tokenList, (tokenID, index, callback) => {
          self.node.services.bitcoind.tokeninfo(tokenID, function(err, tokenInfo) {
            if (!err) {
              console.log('token #' + index + ' ID: ' + tokenID);
              console.log(JSON.stringify(tokenInfo, null, 2));
              delete tokenInfo.result;
              if (!self.cache.tokens[tokenID]) self.cache.tokens[tokenID] = {
                tokenInfo: {},
              };
              self.cache.tokens[tokenID].tokenInfo = tokenInfo;
              self.cache.tokens[tokenID].tokenInfo.ownerAddress = new bitcore.PublicKey(tokenInfo.owner, {network: bitcore.Networks.kmdnet}).toAddress().toString();

              self.node.services.bitcoind.getDetailedTransaction(tokenID, function(err, transaction) {
                if (!err) {
                  self.cache.tokens[tokenID].tokenInfo.blocktime = transaction.blockTimestamp;
                  self.cache.tokens[tokenID].tokenInfo.height = transaction.height;
                  //self.cache.tokens[tokenID].tokenInfo.confirmations = txInfo.result.confirmations;
                  self.cache.tokens[tokenID].tokenInfo.blockhash = transaction.blockHash;
                  self.cache.tokens[tokenID].tokenInfo.syncedHeight = 0;

                  if (index === tokenList.length - 1) {
                    console.log('finsihed syncing token info');
                    resolve();
                  }
                }

                callback();
              });
            } else {
              callback();
            }
          });
        });
      }
    });
  });
};

module.exports = TokensController;
