const { CosmosClient }     = require('@azure/cosmos');
const { BlobServiceClient }= require('@azure/storage-blob');
const OpenAI               = require('openai');
const sgMail               = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cosmos setup
const cosmos = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const container = cosmos
  .database(process.env.COSMOS_DB_DATABASE)
  .container(process.env.COSMOS_DB_COLLECTION);

// Blob setup
const blobSvc = BlobServiceClient.fromConnectionString(
  process.env.BLOB_STORAGE_CONNECTION_STRING
);
const containerClient = blobSvc.getContainerClient(
  process.env.BLOB_CONTAINER
);

module.exports = async function (context, req) {
  try {
    const { fullName, email, company, image } = req.body;

    // 1. Save record to Cosmos DB
    await container.items.create({ fullName, email, company, timestamp: new Date().toISOString() });

    // 2. Send image to OpenAI Image Edit
    const buffer = Buffer.from(image, 'base64');
    const editResponse = await openai.images.edits.create({
      image: buffer,
      mask: buffer,            // using full-image mask to apply effect everywhere
      prompt: "Add a subtle professional frame around the selfie",
      n: 1,
      size: "512x512"
    });
    const editedB64 = editResponse.data[0].b64_json;

    // 3. Upload edited image to Blob
    const filename = `edited-${Date.now()}.png`;
    const blockBlob = containerClient.getBlockBlobClient(filename);
    await blockBlob.uploadData(Buffer.from(editedB64, 'base64'), {
      blobHTTPHeaders: { blobContentType: "image/png" }
    });
    const blobUrl = blockBlob.url;

    // 4. Email via SendGrid
    const msg = {
      to: email,
      from: 'noreply@yourdomain.com',
      subject: 'Your edited selfie is here!',
      html: `<p>Hi ${fullName},<br/>
             Here’s your professionally edited selfie:</p>
             <img src="${blobUrl}" alt="edited selfie" />
             <p>Thanks for using our app!</p>`,
    };
    await sgMail.send(msg);

    context.res = { status: 200, body: { success: true }};
  }
  catch (err) {
    context.log.error(err);
    context.res = {
      status: 500,
      body: { error: err.message }
    };
  }
};
