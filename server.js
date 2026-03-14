const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR);

function getYtDlpPath() {
    const candidates = [path.join(__dirname, 'yt-dlp.exe'), path.join(__dirname, 'yt-dlp'), 'yt-dlp'];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return 'yt-dlp';
}

const YT_DLP = getYtDlpPath();

// URL validation
function isValidUrl(url) {
    return /(tiktok\.com|youtube\.com|youtu\.be)/.test(url);
}

// Fetch Info
app.get('/api/info', (req, res) => {
    const { url } = req.query;
    if (!url || !isValidUrl(url)) {
        return res.status(400).json({ error: 'Please enter a valid URL' });
    }

    const args = [
        '--dump-json',
        '--no-warnings',
        '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        url
    ];

    execFile(YT_DLP, args, { maxBuffer: 15 * 1024 * 1024 }, (error, stdout) => {
        if (error) {
            return res.status(500).json({ error: 'Failed to fetch details.' });
        }

        try {
            const info = JSON.parse(stdout);
            res.json({
                id: info.id,
                title: info.title || 'Video',
                author: info.uploader || info.channel || 'Creator',
                thumbnail: info.thumbnail,
                duration: info.duration_string,
                isYouTube: url.includes('youtube.com') || url.includes('youtu.be')
            });
        } catch (e) {
            res.status(500).json({ error: 'Error parsing data.' });
        }
    });
});

// Download
app.get('/api/download', (req, res) => {
    const { url, type, title } = req.query;
    if (!url || !isValidUrl(url)) return res.status(400).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    const safeTitle = (title || 'video').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '_').slice(0, 50);
    const ext = type === 'mp3' ? 'mp3' : 'mp4';
    const filename = `${safeTitle}_${Date.now()}.${ext}`;
    const outFile = path.join(DOWNLOADS_DIR, filename);

    let args = [
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '--progress',
        '--ffmpeg-location', ffmpegStatic,
        '-o', outFile,
        url
    ];

    if (type === 'mp3') {
        args.push('-x', '--audio-format', 'mp3');
    } else {
        // High compatibility settings for mobile/PC
        args.push('-f', 'bestvideo[vcodec^=avc]+bestaudio[acodec^=mp4a]/best');
        args.push('--recode-video', 'mp4');
        args.push('--postprocessor-args', 'VideoConvertor:-c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 -c:a aac');
    }

    const proc = execFile(YT_DLP, args);

    proc.stdout.on('data', (data) => {
        const line = data.toString().trim();
        const pctMatch = line.match(/(\d+(?:\.\d+)?)%/);
        if (pctMatch) {
            send({ type: 'progress', percent: parseFloat(pctMatch[1]) });
        }
    });

    proc.on('close', (code) => {
        if (code !== 0) {
            send({ type: 'error', message: 'Download failed.' });
            return res.end();
        }
        send({ type: 'done', downloadUrl: `/api/file/${encodeURIComponent(filename)}` });
        res.end();
    });
});

app.get('/api/file/:name', (req, res) => {
    const filePath = path.join(DOWNLOADS_DIR, decodeURIComponent(req.params.name));
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).end();
    }
});

app.listen(PORT, () => console.log(`Pro Downloader running on http://localhost:${PORT}`));
