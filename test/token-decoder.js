'use strict';

var sinon = require('sinon');
var should = require('should');
var TokenDecoder = require('../lib/token-decoder');
var fixtures = require('./data/tokenTransactions.json');

describe('TokenDecoder', function() {
  it('should decode NFT data with 4 fields', function(done) {
    var decodedData = TokenDecoder.readV2NftData('f7010133021168747470733a2f2f746f6b656c2e696f2f0364041168747470733a2f2f746f6b656c2e696f2f');
    should(decodedData).eql({
      "id": 51,
      "url": "https://tokel.io/",
      "royalty": 100,
      "arbitrary": "https://tokel.io/"
    });
    done();
  });

  it('should decode NFT data with 3 fields', function(done) {
    var decodedData = TokenDecoder.readV2NftData('f7010133021168747470733a2f2f746f6b656c2e696f2f0364');
    should(decodedData).eql({
      "id": 51,
      "url": "https://tokel.io/",
      "royalty": 100,
    });
    done();
  });
  
  it('should decode NFT token V2 with 4 fields', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.NFTV2_T1);
    should(decodedData).eql({
      "name": "NFTDataTest",
      "description": "Testing the new NFT data field. How good!",
      "nftData": {
        "id": 51,
        "url": "https://tokel.io/",
        "royalty": 100,
        "arbitrary": "https://tokel.io/"
      },
      "supply": 1,
      "owner": "434da240a00fa003800103af038001f5af038001f7a12da22b802049163d1ec6309fc2cbc07fc13a3951bc938fd15263b0eceb4bcea6d164c0fccb810302040082020204cc",
      "ownerAddress": "RVCq5bZcRgP5xsDfUacC8cDCMauzzRB1RE"
    });
    done();
  });

  it('should decode NFT token V2 with 3 fields', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.NFTV2_T2);
    should(decodedData).eql({
      "name": "Test10",
      "description": "This is a test NFT with a royalty of 100/1000",
      "nftData": {
        "id": 51,
        "url": "https://tokel.io/",
        "royalty": 100
      },
      "supply": 1,
      "owner": "434da240a00fa003800103af038001f5af038001f7a12da22b802049163d1ec6309fc2cbc07fc13a3951bc938fd15263b0eceb4bcea6d164c0fccb810302040082020204cc",
      "ownerAddress": "RVCq5bZcRgP5xsDfUacC8cDCMauzzRB1RE"
    });
    done();
  });

  it('should decode regular token V2', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.V2RegularToken);
    should(decodedData).eql({
      "name": "TEST2",
      "description": "Test token 2",
      "supply": 888,
      "owner": "3e4da23ba00aa003800102af038001f5a12da22b80204dfebf94b3dc9c61191c339326c9457b5262b39479f93d33932d4229e40237ec810302040082020204cc",
      "ownerAddress": "RBtHRZ2yNyw3BeAhYzQzB2e9DkJ2UoNGHK"
    });
    done();
  });

  it('should decode regular token V1 (TOKENSV2 chain)', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.V1RegularToken_T1);
    should(decodedData).eql({
      "name": "TEST",
      "description": "\"Test token\"",
      "supply": 100,
      "owner": "2ea22c8020d7197507817c697a16b2c2db3caf0e4e5148c6c532cf7ae684e653441947ac968103120c008203000401cc",
      "ownerAddress": "RPzyqp3WG9yJD7kTAcY3nzYMxQxYubxUHX"
    });
    done();
  });

  it('should decode regular token V1 (WSB chain)', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.V1RegularToken_T2);
    should(decodedData).eql({
      "name": "tAMC",
      "description": "AMC testing token",
      "supply": 287280000,
      "owner": "2ea22c80209202a22e699ae40477a578fa0ce5e515a7395d0d7562d35fef52eaf0aa9764598103120c008203000401cc",
      "ownerAddress": "RCfKo2Z1Mk3q81z66eLKfdKeBfSDbv4mcU"
    });
    done();
  });

  it('should decode NFT token V1 with JSON encoded data', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.V1NFT_JSON_FORMAT);
    should(decodedData).eql({
      "name": "LAMBO-NFT",
      "description": "\"Lamborgini Aventador\"",
      "nftData": {
        "image":"https://i.ytimg.com/vi/qft8lwmQzns/maxresdefault.jpg",
        "physical":"no"
      },
      "supply": 1,
      "owner": "2ea22c802095aaae8627442f058f63f1a158bc4b0a61425230f0d4dd1f827965fa1413784881032210008203000401cc",
      "ownerAddress": "RB3aHLCjcYn7Vgv5wugvg9QhJ9NkDz7jRu"
    });
    done();
  });

  it('should return null decoding token transfer transaction', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.V1TokenTransfer);
    should(decodedData).eql(null);
    done();
  });

  it('should return null decoding regular transaction (non CC)', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.V1NonCC);
    should(decodedData).eql(null);
    done();
  });

  it('should return null decoding incompatible CC transaction (MCL chain)', function(done) {
    var decodedData = TokenDecoder.decodeTokenDetails(fixtures.IncompatibleCC);
    should(decodedData).eql(null);
    done();
  });
});
