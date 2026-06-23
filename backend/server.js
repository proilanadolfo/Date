import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId, GridFSBucket } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB || 'LoveDb';
const bucketName = 'memories';

if (!mongoUri) {
  console.error('Missing MONGODB_URI in .env');
  process.exit(1);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 60 * 1024 * 1024,
    files: 10,
  },
});

app.use(express.json());
app.use(express.static(projectRoot));

let mongoClient;
let database;
let bucket;

function toMemoryResponse(file) {
  return {
    id: file._id.toString(),
    filename: file.filename,
    contentType: file.metadata?.contentType || 'application/octet-stream',
    uploadDate: file.uploadDate,
    size: file.length,
    url: `/api/uploads/${file._id}/file`,
  };
}

async function connectDatabase() {
  mongoClient = new MongoClient(mongoUri);
  await mongoClient.connect();
  database = mongoClient.db(databaseName);
  bucket = new GridFSBucket(database, { bucketName });
  console.log(`Connected to MongoDB Atlas database: ${databaseName}`);
}

async function uploadFile(file) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(file.originalname, {
      metadata: {
        contentType: file.mimetype,
        originalName: file.originalname,
      },
    });

    uploadStream.once('finish', async () => {
      const savedFile = await database
        .collection(`${bucketName}.files`)
        .findOne({ _id: uploadStream.id });

      resolve(savedFile ? toMemoryResponse(savedFile) : null);
    });

    uploadStream.once('error', reject);
    uploadStream.end(file.buffer);
  });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: databaseName });
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(projectRoot, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(projectRoot, 'admin.html'));
});

app.get('/api/uploads', async (req, res) => {
  try {
    const files = await database
      .collection(`${bucketName}.files`)
      .find({})
      .sort({ uploadDate: -1 })
      .toArray();

    res.json(files.map(toMemoryResponse));
  } catch (error) {
    console.error('Failed to list uploads:', error);
    res.status(500).json({ message: 'Failed to load uploads.' });
  }
});

app.post('/api/uploads', upload.array('media', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'Choose at least one image or video file.' });
    }

    for (const file of req.files) {
      const isSupported = file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/');

      if (!isSupported) {
        return res.status(400).json({ message: `Unsupported file type: ${file.mimetype}` });
      }
    }

    const uploads = [];

    for (const file of req.files) {
      const uploaded = await uploadFile(file);
      if (uploaded) {
        uploads.push(uploaded);
      }
    }

    res.status(201).json({ message: 'Files uploaded successfully.', uploads });
  } catch (error) {
    console.error('Upload failed:', error);
    res.status(500).json({ message: 'Unable to upload files.' });
  }
});

app.get('/api/uploads/:id/file', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.id);
    const file = await database.collection(`${bucketName}.files`).findOne({ _id: fileId });

    if (!file) {
      return res.status(404).json({ message: 'File not found.' });
    }

    res.setHeader('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (error) {
    console.error('Failed to stream upload:', error);
    res.status(500).json({ message: 'Unable to load the file.' });
  }
});

app.delete('/api/uploads/:id', async (req, res) => {
  try {
    const fileId = new ObjectId(req.params.id);
    await bucket.delete(fileId);
    res.json({ message: 'File deleted successfully.' });
  } catch (error) {
    console.error('Failed to delete upload:', error);
    res.status(500).json({ message: 'Unable to delete the file.' });
  }
});

async function startServer() {
  await connectDatabase();

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error('Server startup failed:', error);
  process.exit(1);
});