// POST /api/get-upload-url  ->  { uploadUrl, publicUrl }
//
// Hands the browser a short-lived presigned PUT URL so files go straight to
// Cloudflare R2 and never pass through this function (Vercel caps request
// bodies at 4.5 MB; event photos and PDFs routinely exceed that).
//
// Called by uploadToR2() and the media-gallery save button in index.html.
//
// Signed here with AWS SigV4 using Node's built-in crypto — deliberately no
// @aws-sdk dependency, so the repo stays buildless and vercel.json needs no
// install step.
//
// Required environment variables (Vercel -> Settings -> Environment Variables):
//   R2_ACCOUNT_ID         Cloudflare account id (the R2 endpoint subdomain)
//   R2_BUCKET             bucket name
//   R2_ACCESS_KEY_ID      R2 API token access key id
//   R2_SECRET_ACCESS_KEY  R2 API token secret
//   R2_PUBLIC_BASE        public base URL for reads, no trailing slash —
//                         e.g. https://pub-xxxx.r2.dev or a custom domain
//
// The bucket also needs a CORS rule allowing PUT from the app's origin,
// otherwise the browser blocks the upload before it leaves the page.

const crypto = require("crypto");

const REGION = "auto";
const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";
const EXPIRES = 300; // seconds — the client PUTs immediately

function hmac(key, str) {
  return crypto.createHmac("sha256", key).update(str, "utf8").digest();
}

function sha256hex(str) {
  return crypto.createHash("sha256").update(str, "utf8").digest("hex");
}

// RFC 3986. encodeURIComponent leaves !'()* alone, which S3 rejects.
function uriEncode(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function (c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

// "photo of the tent (2).JPG" -> "photo-of-the-tent-2.jpg", never empty,
// never a path — the key is built from a timestamp plus this.
function safeName(name) {
  var base = String(name || "file").split(/[\\/]/).pop();
  var ext = "";
  var dot = base.lastIndexOf(".");
  if (dot > 0) {
    ext = base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    base = base.slice(0, dot);
  }
  base = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  if (!base) base = "file";
  return ext ? base + "." + ext : base;
}

function presignPut(opts) {
  var host = opts.accountId + ".r2.cloudflarestorage.com";
  var canonicalUri = "/" + uriEncode(opts.bucket) + "/" + opts.key.split("/").map(uriEncode).join("/");

  var now = new Date();
  var amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  var dateStamp = amzDate.slice(0, 8);
  var scope = dateStamp + "/" + REGION + "/" + SERVICE + "/aws4_request";

  var query = {
    "X-Amz-Algorithm": ALGORITHM,
    "X-Amz-Credential": opts.accessKeyId + "/" + scope,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(EXPIRES),
    "X-Amz-SignedHeaders": "host"
  };
  var canonicalQuery = Object.keys(query).sort().map(function (k) {
    return uriEncode(k) + "=" + uriEncode(query[k]);
  }).join("&");

  // Content-Type is sent by the browser but left unsigned — presigned URLs
  // only require the headers listed in SignedHeaders to match.
  var canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    "host:" + host + "\n",
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");

  var stringToSign = [ALGORITHM, amzDate, scope, sha256hex(canonicalRequest)].join("\n");

  var kDate = hmac("AWS4" + opts.secretAccessKey, dateStamp);
  var kRegion = hmac(kDate, REGION);
  var kService = hmac(kRegion, SERVICE);
  var kSigning = hmac(kService, "aws4_request");
  var signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  return "https://" + host + canonicalUri + "?" + canonicalQuery + "&X-Amz-Signature=" + signature;
}

module.exports = function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  var env = process.env;
  var missing = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PUBLIC_BASE"]
    .filter(function (k) { return !env[k]; });
  if (missing.length) {
    // Loud and specific: the old failure mode was a silent HTML response that
    // blew up as a JSON parse error in the browser.
    console.error("get-upload-url: missing env vars:", missing.join(", "));
    return res.status(500).json({ error: "Upload is not configured (missing " + missing.join(", ") + ")" });
  }

  var body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || !body.filename) {
    return res.status(400).json({ error: "filename is required" });
  }

  var contentType = String(body.contentType || "application/octet-stream");
  if (!/^(image|video)\//.test(contentType) && contentType !== "application/pdf") {
    return res.status(400).json({ error: "Unsupported content type: " + contentType });
  }

  var key = new Date().toISOString().slice(0, 10) + "/"
    + Date.now() + "-" + crypto.randomBytes(4).toString("hex") + "-" + safeName(body.filename);

  try {
    var uploadUrl = presignPut({
      accountId: env.R2_ACCOUNT_ID,
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      key: key
    });
    var publicUrl = env.R2_PUBLIC_BASE.replace(/\/+$/, "") + "/" + key.split("/").map(encodeURIComponent).join("/");
    return res.status(200).json({ uploadUrl: uploadUrl, publicUrl: publicUrl, key: key });
  } catch (e) {
    console.error("get-upload-url: presign failed:", e);
    return res.status(500).json({ error: "Could not create upload URL" });
  }
};
