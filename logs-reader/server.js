const express = require('express');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = 3000;

// --- CONFIGURATION ---
const FOLDER_PATH = path.join(__dirname, '..', 'logs'); // The folder where your text files are
const AUTH_KEY = "toshko"; // <--- CHANGE THIS TO YOUR SECRET KEY
// ---------------------

// Middleware
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Ensure the files directory exists
if (!fs.existsSync(FOLDER_PATH)) {
    fs.mkdirSync(FOLDER_PATH);
    console.log(`Created directory: ${FOLDER_PATH}. Put your text files here.`);
}

// HTML Header for mobile friendliness
const htmlHead = `
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; background: #f4f4f4; }
            h1, h2 { color: #333; }
            ul { list-style-type: none; padding: 0; }
            li { background: white; margin: 5px 0; border-radius: 5px; }
            li a { display: block; padding: 15px; text-decoration: none; color: #007bff; font-size: 18px; }
            .content { background: white; padding: 20px; border-radius: 5px; white-space: pre-wrap; word-wrap: break-word; }
            input, button { padding: 10px; font-size: 16px; margin-top: 10px; width: 100%; box-sizing: border-box; }
            button { background: #007bff; color: white; border: none; cursor: pointer; }
            .back-btn { display: inline-block; margin-bottom: 15px; text-decoration: none; color: #555; }
            .error { color: red; background: #ffd2d2; padding: 10px; border-radius: 5px; }
        </style>
    </head>
`;

// Authentication Middleware
const checkAuth = (req, res, next) => {
    if (req.cookies.auth === AUTH_KEY) {
        next();
    } else {
        res.send(`
            <html>
            ${htmlHead}
            <body>
                <h1>🔒 Login Required</h1>
                <form action="/login" method="POST">
                    <input type="password" name="key" placeholder="Enter Secret Key" autofocus>
                    <button type="submit">Enter</button>
                </form>
            </body>
            </html>
        `);
    }
};

// Login Route
app.post('/login', (req, res) => {
    const { key } = req.body;
    if (key === AUTH_KEY) {
        res.cookie('auth', key, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 }); // 30 days
        res.redirect('/');
    } else {
        res.send(`
            <html>${htmlHead}<body>
            <h2 class="error">Wrong Key!</h2>
            <a href="/">Try Again</a>
            </body></html>
        `);
    }
});

// Home Route: List Files
app.get('/', checkAuth, (req, res) => {
    fs.readdir(FOLDER_PATH, (err, files) => {
        if (err) return res.status(500).send("Error reading directory.");

        // Filter to keep simple files (optional) and map to HTML list items
        const fileList = files
            .filter(file => !file.startsWith('.')) // hide hidden files
            .map(file => `<li><a href="/view/${file}">${file}</a></li>`)
            .join('');

        res.send(`
            <html>
            ${htmlHead}
            <body>
                <h1>📂 My Text Files</h1>
                <ul>${fileList || '<li>No files found.</li>'}</ul>
                <br>
                <small>Reading from: ${FOLDER_PATH}</small>
            </body>
            </html>
        `);
    });
});

// View Route: Show Content
app.get('/view/:filename', checkAuth, (req, res) => {
    // SECURITY: path.basename ensures someone can't ask for "../../passwords.txt"
    const filename = path.basename(req.params.filename); 
    const filepath = path.join(FOLDER_PATH, filename);

    fs.readFile(filepath, 'utf8', (err, data) => {
        if (err) return res.send(`<html>${htmlHead}<body><h2>Error</h2><p>File not found or unreadable.</p><a href="/">Back</a></body></html>`);

        res.send(`
            <html>
            ${htmlHead}
            <body>
                <a href="/" class="back-btn">⬅ Back to List</a>
                <h2>📄 ${filename}</h2>
                <div class="content">${data.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
            </body>
            </html>
        `);
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Place your text files in the "files" folder created next to this script.`);
});
