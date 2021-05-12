
const varuintBitcoin = require('varuint-bitcoin');
var transaction = require('./fixtures').nftv2Test1;
transaction.inputs = transaction.vin;
transaction.outputs = transaction.vout;

var isCCTX = false;
//self.node.log.info('tx ' + txid, transaction);

for (var i = 0; i < transaction.outputs.length; i++) {
  console.log(transaction.outputs[i])

  if (transaction.outputs[i].scriptPubKey &&
      transaction.outputs[i].scriptPubKey.asm.indexOf('OP_CHECKCRYPTOCONDITION') > -1) {
    isCCTX = true;
    break;
    //self.node.log.info('tx ' + txid, 'OP_CHECKCRYPTOCONDITION');
  }
}

if (isCCTX) {
  console.log('CC TX');

  var tokenScript = transaction.outputs[transaction.outputs.length - 1].scriptPubKey.asm;
  console.log('script', tokenScript);

  if (tokenScript.indexOf('OP_RETURN ') > -1) {
    // drop opreturn bytes
    tokenScript = tokenScript.substr(10, tokenScript.length);
    console.log('script', tokenScript);

    // drop cc related bytes
    const initialCCBytes = [
      'f26321',
      'f2430121',
      'f5630121',
    ];

    for (var i = 0; i < initialCCBytes.length; i++) {
      if (tokenScript.indexOf(initialCCBytes[i]) > -1) {
        tokenScript = tokenScript.substr(initialCCBytes[i].length, tokenScript.length);
        console.log('script', tokenScript);
      }
    }

    // drop pubkey bytes
    tokenScript = tokenScript.substr(66, tokenScript.length);
    console.log('token hex', tokenScript);
    
    const fieldNames = [
      'name',
      'description',
      'nftData',
    ];
    const nftByteV2 = 'f701';
    const nftV2FieldBytes = [
      {
        sequence: '01',
        type: 'value',
        fieldName: 'id',
      },
      {
        sequence: '02',
        type: 'length',
        fieldName: 'url',
      }, {
        sequence: '03',
        type: 'value',
        fieldName: 'royalty',
      }, {
        sequence: '04',
        type: 'length',
        fieldName: 'arbitrary',
      }
    ];
    let tokenDetails = {};

    const readVar = (hex, type) => {
      const varLen = varuintBitcoin.decode(Buffer.from(hex, 'hex'));
      const varHexLen = varuintBitcoin.encodingLength(varLen) * 2;
      const varDecoded = Buffer.from(tokenScript.substr(varHexLen, varLen * 2), 'hex').toString().trim();
      //console.log(varLen)
      //console.log('varLen', varLen);
      //console.log('varHexLen', varHexLen);
      //console.log('decoded var', type === 'value' ? varLen : varDecoded);
      const hexNext = tokenScript.substr(type === 'value' ? varHexLen : varHexLen + varLen * 2, hex.length);

      return {
        hexCurrent: hex,
        hexNext: hexNext,
        varHexLen: varHexLen,
        varLen: varLen,
        varDecoded: type === 'value' ? varLen : varDecoded,
      };
    };

    // parse token
    let tokenVar;
    let isNftFields = false;

    for (let i = 0; i < 3; i++) {
      tokenVar = readVar(tokenScript);
      tokenScript = tokenVar.hexNext;
      if (tokenVar.varDecoded) tokenDetails[fieldNames[i]] = tokenVar.varDecoded;

      if (i === 2 &&
          !tokenScript.length) {
        try {
          const parsedJson = JSON.parse(tokenVar.varDecoded);
          //console.log('nftv1 json', parsedJson);
          tokenDetails[fieldNames[i]] = parsedJson;
        } catch (e) {}
      }
    }

    console.log(tokenVar)

    if (tokenVar.hexCurrent.indexOf(nftByteV2) > -1) {
      tokenDetails.nftData = {};
      tokenScript = tokenVar.hexCurrent;
      //console.log('parse nftv2');
      tokenScript = tokenScript.substr(tokenScript.indexOf(nftByteV2) + nftByteV2.length, tokenScript.length);
      //console.log('drop nftv2 field bytes', tokenScript);
      // parse nft fields data
      for (let i = 0; i < nftV2FieldBytes.length; i++) {
        if (tokenScript.substr(0, 2) === nftV2FieldBytes[i].sequence) {
          //console.log('field bytes', nftV2FieldBytes[i].sequence);
          tokenScript = tokenScript.substr(nftV2FieldBytes[i].sequence.length, tokenScript.length);
          //console.log(tokenScript)
          tokenVar = readVar(tokenScript, nftV2FieldBytes[i].type);
          tokenScript = tokenVar.hexNext;
          if (tokenVar.varDecoded) tokenDetails.nftData[nftV2FieldBytes[i].fieldName] = tokenVar.varDecoded;
        }
      }
    }

    tokenDetails.supply = transaction.outputs[1].satoshis;

    console.log('tokenDetails', tokenDetails)
  }
}