<?php

// Test G2Pay signature calculation to match our TypeScript implementation

$key = 'osTJIRRk7Kxxt';

// Exact same data from our logs
$data = array(
    'action' => 'SALE',
    'amount' => 100,
    'cardCVV' => '633',
    'cardExpiryMonth' => '02',
    'cardExpiryYear' => '30',
    'cardNumber' => '5599080691308256',
    'countryCode' => 826,
    'currencyCode' => 826,
    'customerEmail' => 'levi@milktree.co',
    'customerName' => 'Levi Eweka',
    'customerPhone' => '07808516998',
    'deviceAcceptContent' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'deviceAcceptEncoding' => 'gzip, deflate, br',
    'deviceAcceptLanguage' => 'en-GB',
    'deviceCapabilities' => 'javascript',
    'deviceChannel' => 'browser',
    'deviceIdentity' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'deviceIpAddress' => '176.25.68.39',
    'deviceScreenResolution' => '1470x956x30',
    'deviceTimeZone' => '0',
    'merchantID' => '283797',
    'orderRef' => 'fe133a5a-59d9-40b4-87ba-f5b472133781',
    'threeDSRedirectURL' => 'https://babybets.co.uk/payment-3ds?orderRef=fe133a5a-59d9-40b4-87ba-f5b472133781',
    'type' => 1,
);

function createSignature(array $data, $key) {
    // Sort by field name
    ksort($data);

    // Create the URL encoded signature string
    $ret = http_build_query($data, '', '&');

    // Normalise all line endings (CRNL|NLCR|NL|CR) to just NL (%0A)
    $ret = str_replace(array('%0D%0A', '%0A%0D', '%0D'), '%0A', $ret);

    echo "Query string:\n";
    echo $ret . "\n\n";

    echo "Query string length: " . strlen($ret) . "\n\n";

    $messageToHash = $ret . $key;
    echo "String to hash (last 50 chars): " . substr($messageToHash, -50) . "\n\n";
    echo "Total length with key: " . strlen($messageToHash) . "\n\n";

    // Hash the signature string and the key together
    $signature = hash('SHA512', $ret . $key);

    return $signature;
}

echo "Testing G2Pay Signature Calculation\n";
echo "====================================\n\n";

$signature = createSignature($data, $key);

echo "Generated Signature:\n";
echo $signature . "\n\n";

echo "Our TypeScript generated:\n";
echo "8549e035844a83b59d5e6adc925bd1e41e3535a38d266b0333b9bb5679b945ab11754e514fbc01548224451cc3b4b73f8299c018c87bf122073051e95b5551c5\n\n";

if ($signature === '8549e035844a83b59d5e6adc925bd1e41e3535a38d266b0333b9bb5679b945ab11754e514fbc01548224451cc3b4b73f8299c018c87bf122073051e95b5551c5') {
    echo "✅ SIGNATURES MATCH!\n";
} else {
    echo "❌ SIGNATURES DO NOT MATCH!\n";
    echo "This means our TypeScript implementation differs from PHP.\n";
}

?>
