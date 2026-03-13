// Test signature with PHP-compatible encoding

const crypto = require('crypto');

function phpRawUrlEncode(str) {
  // PHP's rawurlencode() encodes according to RFC 3986
  // It encodes everything except: A-Z a-z 0-9 - _ . ~
  str = String(str);
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%20/g, '+'); // Spaces as + for application/x-www-form-urlencoded
}

function createSignature(data, signatureKey) {
  // Sort keys alphabetically (same as PHP's ksort)
  const keys = Object.keys(data).sort();

  // Build query string matching PHP's http_build_query() exactly
  const pairs = [];
  keys.forEach(key => {
    const value = String(data[key]);
    const encodedKey = phpRawUrlEncode(key);
    const encodedValue = phpRawUrlEncode(value);
    pairs.push(`${encodedKey}=${encodedValue}`);
  });

  let signatureString = pairs.join('&');

  // Normalise all line endings (CRNL|NLCR|NL|CR) to just NL (%0A)
  signatureString = signatureString
    .replace(/%0D%0A/g, '%0A')
    .replace(/%0A%0D/g, '%0A')
    .replace(/%0D/g, '%0A');

  console.log('Query string:');
  console.log(signatureString);
  console.log('\nQuery string length:', signatureString.length);

  const messageToHash = signatureString + signatureKey;
  console.log('String to hash (last 50 chars):', messageToHash.substring(messageToHash.length - 50));
  console.log('Total length with key:', messageToHash.length);

  const hash = crypto.createHash('sha512').update(messageToHash).digest('hex');
  return hash;
}

const key = 'osTJIRRk7Kxxt';

const data = {
    'action': 'SALE',
    'amount': 100,
    'cardCVV': '633',
    'cardExpiryMonth': '02',
    'cardExpiryYear': '30',
    'cardNumber': '5599080691308256',
    'countryCode': 826,
    'currencyCode': 826,
    'customerEmail': 'levi@milktree.co',
    'customerName': 'Levi Eweka',
    'customerPhone': '07808516998',
    'deviceAcceptContent': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'deviceAcceptEncoding': 'gzip, deflate, br',
    'deviceAcceptLanguage': 'en-GB',
    'deviceCapabilities': 'javascript',
    'deviceChannel': 'browser',
    'deviceIdentity': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'deviceIpAddress': '176.25.68.39',
    'deviceScreenResolution': '1470x956x30',
    'deviceTimeZone': '0',
    'merchantID': '283797',
    'orderRef': 'fe133a5a-59d9-40b4-87ba-f5b472133781',
    'threeDSRedirectURL': 'https://babybets.co.uk/payment-3ds?orderRef=fe133a5a-59d9-40b4-87ba-f5b472133781',
    'type': 1,
};

console.log('Testing Fixed JavaScript Signature');
console.log('===================================\n');

const signature = createSignature(data, key);

console.log('\nGenerated Signature:');
console.log(signature);

const phpSignature = 'b5e27a91ed4ddb2dab6e5632091c7f64f97ddafb3fafe9ee571b37cac989e65dc4d8f156ea6f43cf258a4c7390b4c3380899c906368e3243b4b98fa54f5dedac';
console.log('\nPHP generated:');
console.log(phpSignature);

if (signature === phpSignature) {
    console.log('\n✅✅✅ SIGNATURES MATCH! Problem solved! ✅✅✅');
} else {
    console.log('\n❌ SIGNATURES DO NOT MATCH!');
}
