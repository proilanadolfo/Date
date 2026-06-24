import express from 'express';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ObjectId, GridFSBucket } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI?.trim();
const databaseName = process.env.MONGODB_DB || 'LoveDb';
const bucketName = 'memories';
const backgroundSettingKey = 'backgroundImageId';
const loveImageSettingKey = 'loveImageId';
const siteContentSettingKey = 'siteContent';
const settingsCollectionName = 'site-settings';

const DEFAULT_SITE_CONTENT = {
  heroBadge: '🌹 Our Special Month 🌹',
  heroHeading: 'Happy Monthsary, My Loves',
  heroSubtitle:
    "Another beautiful month with you. Thank you for choosing to spend it with me. Here's to more memories, laughter, and sweet moments together in this long distance journey.",
  heroFooter: "Let's celebrate our beautiful month together! 🌹",
  lovePhotoTitle: 'My Beautiful Love',
  lovePhotoSubtitle: 'Every month with you is precious',
  loveLetterTitle: '💌 A Letter To You',
  loveLetterBody:
    'My dearest,\n\nEvery day with you feels like a dream I never want to wake up from. Even though distance separates us, my heart is always close to yours. Thank you for being my reason to smile, my comfort in hard times, and my greatest joy.\n\nI promise to love you more with each passing day, to be there for you through everything, and to make this distance nothing but a temporary bump in our beautiful love story.\n\nForever yours,\nYour Love 💕',
  memoriesTitle: '💕 Our Memories',
  memoriesSubtitle: 'Moments that make us smile',
  journeyTitle: '📅 Our Journey',
  journeySubtitle: 'Milestones that matter to us',
};

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

app.use((req, res, next) => {
  const allowedOrigins = [
    'https://cindypearl.vercel.app',
    'https://date-58r2.onrender.com',
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

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

function toBackgroundResponse(file) {
  return {
    id: file._id.toString(),
    filename: file.filename,
    contentType: file.metadata?.contentType || 'application/octet-stream',
    uploadDate: file.uploadDate,
    size: file.length,
    url: '/api/background-image/file',
  };
}

function toLoveImageResponse(file) {
  return {
    id: file._id.toString(),
    filename: file.filename,
    contentType: file.metadata?.contentType || 'application/octet-stream',
    uploadDate: file.uploadDate,
    size: file.length,
    url: '/api/love-image/file',
  };
}

async function connectDatabase() {
  const clientOptions = {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    family: 4,
    maxPoolSize: 10,
  };

  mongoClient = new MongoClient(mongoUri, clientOptions);

  try {
    await mongoClient.connect();
    database = mongoClient.db(databaseName);
    await database.command({ ping: 1 });
    bucket = new GridFSBucket(database, { bucketName });
    console.log(`Connected to MongoDB Atlas database: ${databaseName}`);
  } catch (error) {
    console.error('MongoDB connection failed.');
    console.error(
      'Verify MONGODB_URI on Render, allow 0.0.0.0/0 in Atlas Network Access, and URL-encode special characters in the database password.'
    );
    throw error;
  }
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

async function uploadBackgroundFile(file) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(file.originalname, {
      metadata: {
        contentType: file.mimetype,
        originalName: file.originalname,
        kind: 'background',
      },
    });

    uploadStream.once('finish', async () => {
      const savedFile = await database
        .collection(`${bucketName}.files`)
        .findOne({ _id: uploadStream.id });

      resolve(savedFile ? toBackgroundResponse(savedFile) : null);
    });

    uploadStream.once('error', reject);
    uploadStream.end(file.buffer);
  });
}

async function uploadLoveImageFile(file) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(file.originalname, {
      metadata: {
        contentType: file.mimetype,
        originalName: file.originalname,
        kind: 'love-image',
      },
    });

    uploadStream.once('finish', async () => {
      const savedFile = await database
        .collection(`${bucketName}.files`)
        .findOne({ _id: uploadStream.id });

      resolve(savedFile ? toLoveImageResponse(savedFile) : null);
    });

    uploadStream.once('error', reject);
    uploadStream.end(file.buffer);
  });
}

async function getCurrentBackgroundFile() {
  const setting = await database.collection(settingsCollectionName).findOne({ key: backgroundSettingKey });

  if (!setting?.value) {
    return null;
  }

  try {
    const fileId = new ObjectId(setting.value);
    const file = await database.collection(`${bucketName}.files`).findOne({ _id: fileId });
    return file ? toBackgroundResponse(file) : null;
  } catch (error) {
    return null;
  }
}

async function getCurrentLoveImageFile() {
  const setting = await database.collection(settingsCollectionName).findOne({ key: loveImageSettingKey });

  if (!setting?.value) {
    return null;
  }

  try {
    const fileId = new ObjectId(setting.value);
    const file = await database.collection(`${bucketName}.files`).findOne({ _id: fileId });
    return file ? toLoveImageResponse(file) : null;
  } catch (error) {
    return null;
  }
}

async function getExcludedFileIds() {
  const [currentBackground, currentLoveImage] = await Promise.all([
    getCurrentBackgroundFile(),
    getCurrentLoveImageFile(),
  ]);

  const ids = [];

  if (currentBackground?.id) {
    ids.push(new ObjectId(currentBackground.id));
  }

  if (currentLoveImage?.id) {
    ids.push(new ObjectId(currentLoveImage.id));
  }

  return ids;
}

function letterBodyToHtml(body) {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join('<br><br>');
}

function letterHtmlToBody(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function normalizeSiteContent(input = {}) {
  const content = { ...DEFAULT_SITE_CONTENT };

  for (const key of Object.keys(DEFAULT_SITE_CONTENT)) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      content[key] = input[key].trim();
    }
  }

  return content;
}

async function getSiteContent() {
  const setting = await database.collection(settingsCollectionName).findOne({ key: siteContentSettingKey });

  if (!setting?.value || typeof setting.value !== 'object') {
    return { ...DEFAULT_SITE_CONTENT };
  }

  return normalizeSiteContent(setting.value);
}

function toPublicSiteContent(content) {
  return {
    ...content,
    loveLetterHtml: letterBodyToHtml(content.loveLetterBody),
  };
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
    const excludeIds = await getExcludedFileIds();
    const query = excludeIds.length ? { _id: { $nin: excludeIds } } : {};

    const files = await database
      .collection(`${bucketName}.files`)
      .find(query)
      .sort({ uploadDate: -1 })
      .toArray();

    res.json(files.map(toMemoryResponse));
  } catch (error) {
    console.error('Failed to list uploads:', error);
    res.status(500).json({ message: 'Failed to load uploads.' });
  }
});

app.get('/api/background-image', async (req, res) => {
  try {
    const background = await getCurrentBackgroundFile();
    res.json(background);
  } catch (error) {
    console.error('Failed to load background image:', error);
    res.status(500).json({ message: 'Failed to load background image.' });
  }
});

app.get('/api/love-image', async (req, res) => {
  try {
    const loveImage = await getCurrentLoveImageFile();
    res.json(loveImage);
  } catch (error) {
    console.error('Failed to load love image:', error);
    res.status(500).json({ message: 'Failed to load love image.' });
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

app.post('/api/background-image', upload.single('background'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Choose one background image first.' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Background must be an image file.' });
    }

    const currentBackground = await getCurrentBackgroundFile();
    const uploaded = await uploadBackgroundFile(req.file);

    if (!uploaded) {
      return res.status(500).json({ message: 'Unable to save background image.' });
    }

    await database.collection(settingsCollectionName).updateOne(
      { key: backgroundSettingKey },
      { $set: { key: backgroundSettingKey, value: uploaded.id, updatedAt: new Date() } },
      { upsert: true }
    );

    if (currentBackground?.id && currentBackground.id !== uploaded.id) {
      await bucket.delete(new ObjectId(currentBackground.id));
    }

    res.status(201).json({ message: 'Background image updated successfully.', background: uploaded });
  } catch (error) {
    console.error('Background upload failed:', error);
    res.status(500).json({ message: 'Unable to upload background image.' });
  }
});

app.post('/api/love-image', upload.single('loveImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Choose one image first.' });
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'Love image must be an image file.' });
    }

    const currentLoveImage = await getCurrentLoveImageFile();
    const uploaded = await uploadLoveImageFile(req.file);

    if (!uploaded) {
      return res.status(500).json({ message: 'Unable to save love image.' });
    }

    await database.collection(settingsCollectionName).updateOne(
      { key: loveImageSettingKey },
      { $set: { key: loveImageSettingKey, value: uploaded.id, updatedAt: new Date() } },
      { upsert: true }
    );

    if (currentLoveImage?.id && currentLoveImage.id !== uploaded.id) {
      await bucket.delete(new ObjectId(currentLoveImage.id));
    }

    res.status(201).json({ message: 'Love image updated successfully.', loveImage: uploaded });
  } catch (error) {
    console.error('Love image upload failed:', error);
    res.status(500).json({ message: 'Unable to upload love image.' });
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

app.get('/api/background-image/file', async (req, res) => {
  try {
    const background = await getCurrentBackgroundFile();

    if (!background) {
      return res.status(404).json({ message: 'Background image not found.' });
    }

    const fileId = new ObjectId(background.id);
    const file = await database.collection(`${bucketName}.files`).findOne({ _id: fileId });

    if (!file) {
      return res.status(404).json({ message: 'Background image not found.' });
    }

    res.setHeader('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (error) {
    console.error('Failed to stream background image:', error);
    res.status(500).json({ message: 'Unable to load the background image.' });
  }
});

app.get('/api/love-image/file', async (req, res) => {
  try {
    const loveImage = await getCurrentLoveImageFile();

    if (!loveImage) {
      return res.status(404).json({ message: 'Love image not found.' });
    }

    const fileId = new ObjectId(loveImage.id);
    const file = await database.collection(`${bucketName}.files`).findOne({ _id: fileId });

    if (!file) {
      return res.status(404).json({ message: 'Love image not found.' });
    }

    res.setHeader('Content-Type', file.metadata?.contentType || 'application/octet-stream');
    bucket.openDownloadStream(fileId).pipe(res);
  } catch (error) {
    console.error('Failed to stream love image:', error);
    res.status(500).json({ message: 'Unable to load the love image.' });
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

app.get('/api/site-content', async (req, res) => {
  try {
    const content = await getSiteContent();
    res.json(toPublicSiteContent(content));
  } catch (error) {
    console.error('Failed to load site content:', error);
    res.status(500).json({ message: 'Failed to load site content.' });
  }
});

app.put('/api/site-content', async (req, res) => {
  try {
    const content = normalizeSiteContent(req.body);

    await database.collection(settingsCollectionName).updateOne(
      { key: siteContentSettingKey },
      { $set: { key: siteContentSettingKey, value: content, updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({
      message: 'Site text updated successfully.',
      content: toPublicSiteContent(content),
    });
  } catch (error) {
    console.error('Failed to update site content:', error);
    res.status(500).json({ message: 'Unable to update site content.' });
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