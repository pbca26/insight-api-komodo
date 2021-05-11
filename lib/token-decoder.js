
const varuintBitcoin = require('varuint-bitcoin');
var transaction = require('./fixtures').transfer;
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

  var contractScript = transaction.outputs[transaction.outputs.length - 1].scriptPubKey.asm;
  console.log('script', contractScript);

  if (contractScript.indexOf('OP_RETURN ') > -1) {
    contractScript = contractScript.substr(10, contractScript.length);
    console.log('script', contractScript);

    if (contractScript.indexOf('f26321') > -1) {
      contractScript = contractScript.substr(6, contractScript.length);
      console.log('script 6', contractScript);
    }
    if (contractScript.indexOf('f2430121') > -1 || contractScript.indexOf('f5630121') > -1) {
      contractScript = contractScript.substr(8, contractScript.length);
      console.log('script 8', contractScript);
    }
    contractScript = contractScript.substr(66, contractScript.length);
    contractScript = contractScript.substr(0, contractScript.length);
    console.log('token hex', contractScript);

    const contractNameLen = varuintBitcoin.decode(Buffer.from(contractScript, 'hex'));
    const contractNameHexLen = varuintBitcoin.encodingLength(contractNameLen) * 2;
    console.log(contractNameLen)
    console.log('contractNameLen', contractNameLen);
    console.log('name', Buffer.from(contractScript.substr(contractNameHexLen, contractNameLen * 2), 'hex').toString().trim())

    var contractDescHex = contractScript.substr(contractNameHexLen + contractNameLen * 2);
    const contractDescLen = varuintBitcoin.decode(Buffer.from(contractDescHex, 'hex'));
    console.log('contractDescLen', contractDescLen)
    const contractDescHexLen = varuintBitcoin.encodingLength(contractDescLen) * 2;
    console.log(contractDescLen.toString(16))
    console.log('contractDescLen', contractDescLen);
    console.log('desc', Buffer.from(contractDescHex.substr(contractDescHexLen, contractDescLen * 2), 'hex').toString().trim())
    
    const contractNftPayload = contractScript.substr(contractNameHexLen + contractNameLen * 2 + contractDescHexLen + contractDescLen * 2);
    console.log('contractNftPayload', contractNftPayload)

    var v2DelimBytes = {
      'nft': 'f701',
      'nftHex': {
        idField: '01',
        urlField: '02',
        royaltyField: '03',
        arbitraryField: '04',
      },
    };

    // v2 nft
    if (contractNftPayload.length &&
        contractNftPayload.indexOf(v2DelimBytes.nft) > -1) {
      var contractNftDecoded = {}

      var nftDataStripVersionBytes = contractNftPayload.substr(contractNftPayload.indexOf(v2DelimBytes.nft) + v2DelimBytes.nft.length, contractNftPayload.length);
      console.log(nftDataStripVersionBytes)

      if (nftDataStripVersionBytes.substr(0, 2) === v2DelimBytes.nftHex.idField) {
        console.log('read id field', nftDataStripVersionBytes.substr(2))

        const idFieldVal = varuintBitcoin.decode(Buffer.from(nftDataStripVersionBytes.substr(2, nftDataStripVersionBytes.length), 'hex'));
        const idFieldValHexLen = varuintBitcoin.encodingLength(idFieldVal) * 2;
        contractNftDecoded.id = idFieldVal;

        if (nftDataStripVersionBytes.substr(2 + idFieldValHexLen, 2) === v2DelimBytes.nftHex.urlField) {
          console.log('read url field', nftDataStripVersionBytes.substr(2 + idFieldValHexLen, nftDataStripVersionBytes.length));
          const urlFieldLen = varuintBitcoin.decode(Buffer.from(nftDataStripVersionBytes.substr(4 + idFieldValHexLen, nftDataStripVersionBytes.length), 'hex'));
          const urlFieldHexLen = varuintBitcoin.encodingLength(urlFieldLen) * 2;
          console.log(urlFieldLen);
          const urlFieldBytesLen = urlFieldLen * 2;
          const urlFieldValHex = nftDataStripVersionBytes.substr(4 + idFieldValHexLen + urlFieldHexLen, urlFieldBytesLen);
          const urlFieldValHuman = Buffer.from(urlFieldValHex, 'hex').toString().trim();
          console.log(urlFieldValHuman);
          contractNftDecoded.url = urlFieldValHuman;
          const royaltyFieldHex = nftDataStripVersionBytes.substr(nftDataStripVersionBytes.indexOf(urlFieldValHex) + urlFieldBytesLen, nftDataStripVersionBytes.length);

          if (royaltyFieldHex.substr(0, 2) === v2DelimBytes.nftHex.royaltyField) {
            console.log('read royalty field', royaltyFieldHex);
            const royaltyFieldNum = varuintBitcoin.decode(Buffer.from(royaltyFieldHex.substr(2, royaltyFieldHex.length), 'hex'));
            const royaltyFieldHexLen = varuintBitcoin.encodingLength(royaltyFieldNum) * 2;
            console.log(royaltyFieldNum);
            contractNftDecoded.royalty = royaltyFieldNum;
            const arbitraryFieldHex = royaltyFieldHex.substr(2 + royaltyFieldHexLen, royaltyFieldHex.length);
            console.log('arbitraryFieldHex', arbitraryFieldHex)

            if (arbitraryFieldHex.substr(0, 2) === v2DelimBytes.nftHex.arbitraryField) {
              console.log('read arbitrary field', arbitraryFieldHex);
              const arbitraryFieldLen = varuintBitcoin.decode(Buffer.from(arbitraryFieldHex.substr(2, arbitraryFieldHex.length), 'hex'));
              const arbitraryFieldHexLen = varuintBitcoin.encodingLength(royaltyFieldNum) * 2;
              console.log('arbitraryFieldLen', arbitraryFieldLen);
              
              const arbitraryFieldBytesLen = arbitraryFieldLen * 2;
              const arbitraryFieldValHex = arbitraryFieldHex.substr(2 + arbitraryFieldHexLen, arbitraryFieldBytesLen);
              const arbitraryFieldValHuman = Buffer.from(arbitraryFieldValHex, 'hex').toString().trim();
              console.log(arbitraryFieldValHuman);
              contractNftDecoded.arbitrary = arbitraryFieldValHuman;
            }
          }
        }         
      }

      console.log('contractNftDecoded', contractNftDecoded)
    } else if (contractNftPayload.length && contractNftPayload !== '00') {
      const contractNftPayloadLen = varuintBitcoin.decode(Buffer.from(contractNftPayload, 'hex'));
      const contractNftPayloadHexLen = varuintBitcoin.encodingLength(contractNftPayloadLen) * 2;
      //console.log(contractNftPayloadLen)
      try {
        console.log('nftv1 json', JSON.parse(Buffer.from(contractNftPayload.substr(contractNftPayloadHexLen, contractNftPayloadLen * 2), 'hex').toString().trim()));
      } catch (e) {
        console.log('nftv1', Buffer.from(contractNftPayload.substr(contractNftPayloadHexLen, contractNftPayloadLen * 2), 'hex').toString().trim())
      }
    }
  }
}