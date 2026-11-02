const crypto = require('crypto');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../utils/logger');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

// Kicks off a Paystack transaction in test mode and returns the checkout
// URL + reference the client redirects to. Amount is converted to kobo,
// since Paystack's API expects the smallest currency unit.
async function initializeTransaction({ email, amountNaira, reference, metadata }) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    throw new ApiError(500, 'Paystack secret key is not configured');
  }

  const timeoutMs = Number(process.env.PAYSTACK_TIMEOUT_MS) || 10000;

  let response;
  try {
    response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: Math.round(amountNaira * 100),
        reference,
        metadata,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    logger.error(`paystack initialize request failed: ${err.message}`);
    throw new ApiError(502, 'Failed to initialize payment with Paystack');
  }

  const body = await response.json();

  if (!response.ok || !body.status) {
    logger.error(`paystack initialize failed: ${body.message || response.status}`);
    throw new ApiError(502, 'Failed to initialize payment with Paystack');
  }

  return {
    authorizationUrl: body.data.authorization_url,
    accessCode: body.data.access_code,
    reference: body.data.reference,
  };
}

// Verifies that a webhook payload genuinely came from Paystack. This is the
// #1 skipped step in bad implementations: without it, anyone who guesses the
// webhook URL could POST a fake "payment successful" event and get a free
// order accepted. Must be computed over the *raw* request body - if Express's
// JSON parser has already re-serialized it, the signature will never match.
function verifyWebhookSignature(rawBody, signatureHeader) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey || !signatureHeader) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  const providedBuffer = Buffer.from(signatureHeader, 'utf8');

  // timingSafeEqual throws if buffer lengths differ, and a forged signature
  // of the wrong length is exactly the case we need to reject, not crash on.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

module.exports = { initializeTransaction, verifyWebhookSignature };
