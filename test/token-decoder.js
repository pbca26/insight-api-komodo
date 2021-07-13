'use strict';

var sinon = require('sinon');
var should = require('should');
var TokenDecoder = require('../lib/token-decoder');
var fixtures = require('./data/tokenTransactions.json');

describe('TokenDecoder', function() {
  it('should decode NFT data with 4 fields', function(done) {
    var decodedData = TokenDecoder.readV2NftData('f7010133021168747470733a2f2f746f6b656c2e696f2f0364041168747470733a2f2f746f6b656c2e696f2f');
    should(decodedData).eql({
      id: 51,
      url: 'https://tokel.io/',
      royalty: 100,
      arbitrary: 'https://tokel.io/'
    });
    done();
  });

  it('should decode NFT data with 3 fields', function(done) {
    var decodedData = TokenDecoder.readV2NftData('f7010133021168747470733a2f2f746f6b656c2e696f2f0364');
    should(decodedData).eql({
      id: 51,
      url: 'https://tokel.io/',
      royalty: 100,
    });
    done();
  });
  
  it('should decode NFT token V2 with 4 fields', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.NFTV2_T1);
    should(decodedData).eql({
      name: 'NFTDataTest',
      description: 'Testing the new NFT data field. How good!',
      nftData: {
        id: 51,
        url: 'https://tokel.io/',
        royalty: 100,
        arbitrary: 'https://tokel.io/'
      },
      supply: 1,
      owner: '434da240a00fa003800103af038001f5af038001f7a12da22b802049163d1ec6309fc2cbc07fc13a3951bc938fd15263b0eceb4bcea6d164c0fccb810302040082020204cc',
      ownerAddress: 'RVCq5bZcRgP5xsDfUacC8cDCMauzzRB1RE'
    });
    done();
  });

  it('should decode NFT token V2 with 3 fields', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.NFTV2_T2);
    should(decodedData).eql({
      name: 'Test10',
      description: 'This is a test NFT with a royalty of 100/1000',
      nftData: {
        id: 51,
        url: 'https://tokel.io/',
        royalty: 100
      },
      supply: 1,
      owner: '434da240a00fa003800103af038001f5af038001f7a12da22b802049163d1ec6309fc2cbc07fc13a3951bc938fd15263b0eceb4bcea6d164c0fccb810302040082020204cc',
      ownerAddress: 'RVCq5bZcRgP5xsDfUacC8cDCMauzzRB1RE'
    });
    done();
  });

  it('should decode regular token V2', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.V2RegularToken);
    should(decodedData).eql({
      name: 'TEST2',
      description: 'Test token 2',
      supply: 888,
      owner: '3e4da23ba00aa003800102af038001f5a12da22b80204dfebf94b3dc9c61191c339326c9457b5262b39479f93d33932d4229e40237ec810302040082020204cc',
      ownerAddress: 'RBtHRZ2yNyw3BeAhYzQzB2e9DkJ2UoNGHK'
    });
    done();
  });

  it('should decode regular token V1 (TOKENSV2 chain)', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.V1RegularToken_T1);
    should(decodedData).eql({
      name: 'TEST',
      description: '\"Test token\"',
      supply: 100,
      owner: '2ea22c8020d7197507817c697a16b2c2db3caf0e4e5148c6c532cf7ae684e653441947ac968103120c008203000401cc',
      ownerAddress: 'RPzyqp3WG9yJD7kTAcY3nzYMxQxYubxUHX'
    });
    done();
  });

  it('should decode regular token V1 (WSB chain)', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.V1RegularToken_T2);
    should(decodedData).eql({
      name: 'tAMC',
      description: 'AMC testing token',
      supply: 287280000,
      owner: '2ea22c80209202a22e699ae40477a578fa0ce5e515a7395d0d7562d35fef52eaf0aa9764598103120c008203000401cc',
      ownerAddress: 'RCfKo2Z1Mk3q81z66eLKfdKeBfSDbv4mcU'
    });
    done();
  });

  it('should decode NFT token V1 with JSON encoded data', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.V1NFT_JSON_FORMAT);
    should(decodedData).eql({
      name: 'LAMBO-NFT',
      description: '\"Lamborgini Aventador\"',
      nftData: {
        image: 'https://i.ytimg.com/vi/qft8lwmQzns/maxresdefault.jpg',
        physical: 'no'
      },
      supply: 1,
      owner: '2ea22c802095aaae8627442f058f63f1a158bc4b0a61425230f0d4dd1f827965fa1413784881032210008203000401cc',
      ownerAddress: 'RB3aHLCjcYn7Vgv5wugvg9QhJ9NkDz7jRu'
    });
    done();
  });

  it('should return null decoding token transfer transaction', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.v1Cancel);
    should(decodedData).eql(null);
    done();
  });

  it('should return null decoding regular transaction (non CC)', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.V1NonCC);
    should(decodedData).eql(null);
    done();
  });

  it('should return null decoding incompatible CC transaction (MCL chain)', function(done) {
    var decodedData = TokenDecoder.decodeTokenCreateDetails(fixtures.IncompatibleCC);
    should(decodedData).eql(null);
    done();
  });

  it('should return decoded token create transaction v2', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.V2RegularToken);
    should(decodedData).eql({
      txid: '118a95dd6aa92bedc13f223ad5f51a6d6c113313b0f2cc16107e2cac0ccf643c',
      type: 'create',
      evalcode: 'f5',
      funcid: '63',
      version: '02',
      tokenid: '118a95dd6aa92bedc13f223ad5f51a6d6c113313b0f2cc16107e2cac0ccf643c',
      asset: {
        evalcode: 'ae',
        funcid: '05',
        version: '54'
      },
      create: {
        name: 'TEST2',
        description: 'Test token 2',
        supply: 888,
        owner: '3e4da23ba00aa003800102af038001f5a12da22b80204dfebf94b3dc9c61191c339326c9457b5262b39479f93d33932d4229e40237ec810302040082020204cc',
        ownerAddress: 'RBtHRZ2yNyw3BeAhYzQzB2e9DkJ2UoNGHK'
      }
    });
    done();
  });

  it('should return decoded NFT fillask transaction with royalty percentage output', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.nftRoyaltyFillask, {royalty: 100});
    should(decodedData).eql({
      txid: '57fefeeadbf77b301cf6ab7e467110917cd78ec31ba548ffe1acc63b4cbe5ffb',
      type: 'fillask',
      evalcode: 'f5',
      funcid: '74',
      version: '02',
      tokenid: 'fbf6adcd04da2cdd925048a4cd7944474e3c034c85fbf2957434213a7ac00d91',
      asset: {
        evalcode: 'f6',
        funcid: '53',
        version: '01'
      },
      order: {
        amount: {
          satoshis: 0,
          value: 0
        },
        price: {
          satoshis: 100000000000,
          value: 1000
        },
        required: {
          satoshis: 0,
          value: 0
        },
        royalty: {
          royaltyValue: 100,
          royaltyPercentage: 10,
          value: 100,
          satoshis: 10000000000,
          voutIndex: 3,
          receiver: {
            pubkey: '2102ed3fcb2ace8a53cd8ed5350dc53c507167ad39238ba70345e51764c6d517e6eeac',
            address: 'RN3hmR5oGXPpLW8oyxpVEizoNHN3Equvmh'
          }
        }
      },
      transfer: {
        from: 'RDuCVFxBBjEUbvqvP5Jy7z2z1V3oMSZ6qS',
        to: 'RWjAJxekRfn7aNPVwozehmPjxNdYPRFNTy',
        value: 1
      }
    });
    done();
  });

  it('should return decoded cancel transaction v1', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v1Cancel);
    should(decodedData).eql({
      txid: '9ac136af397cc8d1113f484643828f1ee376cdc525f76bf3fce7aefbdeccc339',
      type: 'cancel',
      evalcode: 'f2',
      funcid: '54',
      version: '01',
      tokenid: '28a4d64e9028a2b0a3b2c774917a8739fd79f903ab2dcff3a3085e1fcc4a531f',
      asset: {
        evalcode: '21',
        funcid: '03',
        version: 'd5'
      },
      transfer: {
        from: 'RTWtxY7GTBZ3zL8jfzyWWz1fveF3KXKBF8',
        to: 'RPzyqp3WG9yJD7kTAcY3nzYMxQxYubxUHX',
        value: 9
      }
    });
    done();
  });
  
  it('should return decoded transfer transaction v2', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v2Transfer);
    should(decodedData).eql({
      txid: 'd0e228fc404b3fbe9dc8fd7fa6fdc7f3db9e4e029a45e37f90d3352489eb12e4',
      type: 'transfer',
      evalcode: 'f5',
      funcid: '74',
      version: '02',
      tokenid: '1c985cdba876665384c732c0532d352746559674f4c185cf7169f41ae5d3cf2e',
      asset: {
        evalcode: '',
        funcid: '',
        version: ''
      },
      transfer: {
        from: 'RYFYqwrCPfqznk4KkzXatqiDk82kNwr1oZ',
        to: 'RBtHRZ2yNyw3BeAhYzQzB2e9DkJ2UoNGHK',
        value: 5
      }
    });
    done();
  });

  it('should return decoded token create transaction v1', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.V1RegularToken_T1);
    should(decodedData).eql({
      txid: '28a4d64e9028a2b0a3b2c774917a8739fd79f903ab2dcff3a3085e1fcc4a531f',
      type: 'create',
      evalcode: 'f2',
      funcid: '43',
      version: '01',
      tokenid: '28a4d64e9028a2b0a3b2c774917a8739fd79f903ab2dcff3a3085e1fcc4a531f',
      asset: {
        evalcode: 'ae',
        funcid: '04',
        version: '54'
      },
      create: {
        name: 'TEST',
        description: '\"Test token\"',
        supply: 100,
        owner: '2ea22c8020d7197507817c697a16b2c2db3caf0e4e5148c6c532cf7ae684e653441947ac968103120c008203000401cc',
        ownerAddress: 'RPzyqp3WG9yJD7kTAcY3nzYMxQxYubxUHX'
      }
    });
    done();
  });

  it('should return decoded token create transaction v2 (tokel nft)', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.tokelFormatNft);
    should(decodedData).eql({
      "txid":"6610ffe5d05a8a58e732e4a8c7076fca8c266e690046f1f546e227c65fa9706a",
      "type":"create",
      "evalcode":"f5",
      "funcid":"63",
      "version":"02",
      "tokenid":"6610ffe5d05a8a58e732e4a8c7076fca8c266e690046f1f546e227c65fa9706a",
      "asset":{
        "evalcode":"0a",
        "funcid":"0b",
        "version":"4e"
      },
      "create":{
        "name":"NewT0912ken",
        "description":"Just a random token. 12$%^&*()_+-={}][",
        "nftData":{
          "url":"https://tokel.io/roadmap",
          "id":69,
          "royalty":100,
          "arbitrary":"This is a test hex string to incorporate arbitrary data."
        },
        "supply":1,
        "owner":"434da240a00fa003800103af038001f5af038001f7a12da22b802054748d79e51c2210343aea514bbb3c3370a95f1ff5923ad1e49f9f7d9e0eed28810302040082020204cc270402f701012102743d2afdb88ede68fb5938e961b1f41c2b6267b3286516543eb4e4ab87ad0d0a75",
        "ownerAddress":"RPoNgF2T4iRKT8Sjoc2ty4VZ8Q8cXfhqgB"
      }
    });
    done();
  });

  it('should return decoded token fill order transaction v1', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v1Fill);
    should(decodedData).eql({
      txid: '87db13134c5d1625e93dac3fd6aa29a1a80823dcf1d07f131f67a91e0789d223',
      type: 'fill',
      evalcode: 'f2',
      funcid: '54',
      version: '01',
      tokenid: '28a4d64e9028a2b0a3b2c774917a8739fd79f903ab2dcff3a3085e1fcc4a531f',
      asset: {
        evalcode: '21',
        funcid: '03',
        version: 'd5'
      },
      order: {
        price: {
          value: 0.01
        },
        amount: {
          value: 1
        }
      },
      transfer: {
        from: 'RTWtxY7GTBZ3zL8jfzyWWz1fveF3KXKBF8',
        to: 'RPzyqp3WG9yJD7kTAcY3nzYMxQxYubxUHX',
        value: 1
      }
    });
    done();
  });

  it('should return decoded token ask order transaction v1', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v1Ask);
    should(decodedData).eql({
      txid: '63c73e62470ca366cf793afbc68179a4b8be36f9c34b8766e50ea23af2d763e4',
      type: 'transfer',
      evalcode: 'f2',
      funcid: '54',
      version: '01',
      tokenid: '28a4d64e9028a2b0a3b2c774917a8739fd79f903ab2dcff3a3085e1fcc4a531f',
      asset: {
        evalcode: '21',
        funcid: '02',
        version: 'ad'
      },
      transfer: {
        from: 'RPzyqp3WG9yJD7kTAcY3nzYMxQxYubxUHX',
        to: 'RTWtxY7GTBZ3zL8jfzyWWz1fveF3KXKBF8',
        value: 10
      }
    });
    done();
  });

  it('should return decoded token fillbid transaction v2', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v2Fillbid);
    should(decodedData).eql({
      txid: '0651364ce5495fb062246a8c5d1f746053b3146d49e603e9b906f8256b9945dd',
      type: 'fillbid',
      evalcode: 'f5',
      funcid: '74',
      version: '02',
      tokenid: '1c985cdba876665384c732c0532d352746559674f4c185cf7169f41ae5d3cf2e',
      asset: {
        evalcode: 'f6',
        funcid: '42',
        version: '01'
      },
      order: {
        amount: {
          satoshis: 10000000,
          value: 0.1
        },
        price: {
          satoshis: 10000000,
          value: 0.1
        },
        required: {
          satoshis: 1,
          value: 1e-8
        }
      },
      transfer: {
        from: 'RYFYqwrCPfqznk4KkzXatqiDk82kNwr1oZ',
        to: 'RNUHPRGMLWMyVwi6vWmayynoJv5gixmLbg',
        value: 10000
      }
    });
    done();
  });

  it('should return decoded token fillask transaction v2', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v2Fillask);
    should(decodedData).eql({
      txid: '2b9677f10c05400f888240ed232be70b9e9bfbe155f0fda559637450e757a645',
      type: 'fillask',
      evalcode: 'f5',
      funcid: '74',
      version: '02',
      tokenid: '1c985cdba876665384c732c0532d352746559674f4c185cf7169f41ae5d3cf2e',
      asset: {
        evalcode: 'f6',
        funcid: '53',
        version: '01'
      },
      order: {
        amount: {
          satoshis: 100000000000000,
          value: 1000000
        },
        price: {
          satoshis: 10000000,
          value: 0.1
        },
        required: {
          satoshis: 10000000,
          value: 0.1
        }
      },
      transfer: {
        from: 'RLN5VzzcMmiiGEyjsM66dkKxKdiERbGtCf',
        to: 'RLN5VzzcMmiiGEyjsM66dkKxKdiERbGtCf',
        value: 1
      }
    });
    done();
  });

  it('should return decoded token bid transaction v2', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v2Bid);
    should(decodedData).eql({
      txid: '40a6f5f36c6346c6096607e0fed2a477b1cb303d4074b29a0688b76aa84feb4c',
      type: 'bid',
      evalcode: 'f5',
      funcid: '74',
      version: '02',
      tokenid: '1c985cdba876665384c732c0532d352746559674f4c185cf7169f41ae5d3cf2e',
      asset: {
        evalcode: 'f6',
        funcid: '62',
        version: '01'
      },
      order: {
        amount: {
          satoshis: 20000000,
          value: 0.2
        },
        price: {
          satoshis: 10000000,
          value: 0.1
        },
        required: {
          satoshis: 2,
          value: 2e-8
        }
      }
    });
    done();
  });

  it('should return decoded token ask transaction v2', function(done) {
    var decodedData = TokenDecoder.decodeOpreturn(fixtures.v2Ask);
    should(decodedData).eql({
      txid: '2c55fd78abbf645886c4e3d0608ab6d722e0acf916f60c2bd4079fbe76977969',
      type: 'ask',
      evalcode: 'f5',
      funcid: '74',
      version: '02',
      tokenid: '1c985cdba876665384c732c0532d352746559674f4c185cf7169f41ae5d3cf2e',
      asset: {
        evalcode: 'f6',
        funcid: '73',
        version: '01'
      },
      order: {
        amount: {
          satoshis: 200000000000000,
          value: 2000000
        },
        price: {
          satoshis: 10000000,
          value: 0.1
        },
        required: {
          satoshis: 20000000,
          value: 0.2
        }
      },
      transfer: {
        from: 'RYFYqwrCPfqznk4KkzXatqiDk82kNwr1oZ',
        to: 'RLN5VzzcMmiiGEyjsM66dkKxKdiERbGtCf',
        value: 2
      }
    });
    done();
  });
});
