var express = require('express');
var router = express.Router();
const multer = require('multer');
const AdmZip = require('adm-zip');
const axios = require("axios");
const { pipeline } = require('@xenova/transformers');
const CodeModel = require('../model/UploadModel');
require("dotenv").config();
const ProjectModel = require('../model/ProjectModel');
const ChatMessageModel = require('../model/ChatMessage');

const upload = multer({ dest: 'uploads/' });
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const BLACKLIST_FOLDERS = ['node_modules', '.git', '.angular', '.next', 'dist', 'build', '.vscode', 'cache', 'vendor'];
const VALID_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.py', '.html', '.css', '.java', '.c', '.cpp'];

let embedder;

// Reusable function to get the embedding model
const getEmbedder = async () => {
    if (!embedder) {
        embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return embedder;
};


const processAndSaveToDB = async (extractedFiles,   projectId) => {
    const extractor = await getEmbedder();
    let chunks = [];

    extractedFiles.forEach(file => {
        
        for (let i = 0; i < file.content.length; i += 500) {
            chunks.push({
                fileName: file.fileName,
                text: file.content.substring(i, i + 500)
            });
        }
    });

    console.log(`Generating Embeddings for ${chunks.length} chunks...`);

    const dataToSave = [];
    for (const chunk of chunks) {
        const output = await extractor(chunk.text, { pooling: 'mean', normalize: true });
 
        dataToSave.push({
            projectId: projectId,
            fileName: chunk.fileName,
            content: chunk.text,
            embedding: Array.from(output.data)
        });
    }

    await CodeModel.insertMany(dataToSave);
    
    return chunks.length;
};

// --- ROUTE 1: LOCAL ZIP UPLOAD ---
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "File upload cheyandi!" });

        const newProject = await ProjectModel.create({
            name: req.file.originalname,
            type: 'zip'
        });

        const zip = new AdmZip(req.file.path);
        const zipEntries = zip.getEntries();
        
        let extractedFiles = [];
        zipEntries.forEach((entry) => {
            const name = entry.entryName.toLowerCase();
            if (entry.isDirectory) return;
            
            const isBlacklisted = BLACKLIST_FOLDERS.some(folder => name.includes(folder));
            const hasValidExt = VALID_EXTENSIONS.some(ext => name.endsWith(ext));

            if (!isBlacklisted && hasValidExt) {
                extractedFiles.push({
                    fileName: entry.entryName,
                    content: entry.getData().toString('utf8')
                });
            }
        });

        console.log("UnZip is Successful...");

        const count = await processAndSaveToDB(extractedFiles, newProject._id);
        
        console.log("Saved in DB....");
        res.json({ 
            success: true, 
            message: "Local Code Processed & Saved!", 
            projectId: newProject._id,
            name:newProject.name,
            count 
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ROUTE 2: GITHUB UPLOAD ---
router.post('/github-upload', async (req, res) => {
    try {
        const { githubUrl } = req.body; 
        const parts = githubUrl.replace("https://github.com/", "").split("/");
        const owner = parts[0];
        const repo = parts[1];

        // 1. Create Project for GitHub Repo
        const newProject = await ProjectModel.create({
            name: repo,
            type: 'github'
        });

        const zipUrl = `https://github.com/${owner}/${repo}/archive/refs/heads/main.zip`;
        console.log(`⏳ Downloading from GitHub: ${zipUrl}`);

        const response = await axios({ method: 'get', url: zipUrl, responseType: 'arraybuffer' });
        const zip = new AdmZip(Buffer.from(response.data));
        const zipEntries = zip.getEntries();
        
        let extractedFiles = [];
        zipEntries.forEach(entry => {
            const name = entry.entryName.toLowerCase();
            if (!entry.isDirectory && VALID_EXTENSIONS.some(ext => name.endsWith(ext)) && !BLACKLIST_FOLDERS.some(f => name.includes(f))) {
                extractedFiles.push({
                    fileName: entry.entryName,
                    content: entry.getData().toString('utf8')
                });
            }
        });

        // 2. Pass the newProject._id here too
        const count = await processAndSaveToDB(extractedFiles, newProject._id);
        res.json({ 
            success: true, 
            message: `GitHub Repo '${repo}' Processed & Saved!`, 
            projectId: newProject._id, 
            count 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "GitHub processing failed!" });
    }
});

router.post("/ask", async (req, res) => {
  try {
    const { question, projectId } = req.body;
    console.log(`[1] Request received for project: ${projectId}`);

    if (!projectId || !question) {
      return res.status(400).json({ error: "Project ID and Question are required" });
    }

    console.log("[2] Vectorizing question...");
    const extractor = await getEmbedder();
    const output = await extractor(question, { pooling: "mean", normalize: true });
    const questionVector = Array.from(output.data);

    console.log("[3] Fetching code from DB...");
    const projectCode = await CodeModel.find({ projectId }).lean(); // .lean() makes it faster
    
    if (!projectCode || projectCode.length === 0) {
      console.warn("[!] No code found for this project ID.");
      return res.status(404).json({ error: "No code found for this project. Please re-upload." });
    }

    console.log(`[4] Calculating similarity for ${projectCode.length} snippets...`);
    const results = projectCode.map((item) => ({
      fileName: item.fileName,
      content: item.content,
      score: calculateSimilarity(questionVector, item.embedding)
    }));

    // NOW this should definitely print
    console.log("[5] Top Result Score:", results[0]?.score);

    const topMatches = results
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

   const contextText = topMatches.map(m => `File: ${m.fileName}\nCode: ${m.content}`).join("\n\n---\n\n");


    console.log("[6] Sending to OpenRouter...");
    console.log(contextText);
    const aiResponse = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "qwen/qwen3-vl-235b-a22b-thinking",
        max_tokens: 4096,
        messages: [
          { role: "system", content: "You are an expert developer..." },
          { role: "user", content: `Context:\n${contextText}\n\nQuestion: ${question}` }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const fullAnswer = aiResponse.data.choices[0].message.content;
    console.log("[7] AI responded. Saving to DB...");

    const [savedUserMsg, savedAiMsg] = await Promise.all([
      ChatMessageModel.create({ projectId, role: "user", content: question }),
      ChatMessageModel.create({
        projectId,
        role: "assistant",
        content: fullAnswer,
        sources: topMatches.map(m => ({
          fileName: m.fileName,
          codeSnippet: m.content,
          lineRange: "Source Snippet"
        }))
      })
    ]);

    console.log("[8] Success!");
    res.json({
      success: true,
      answer: fullAnswer,
      sources: savedAiMsg.sources
    });

  } catch (error) {
    // Check if the error happened during the AI call or before
    console.error("Critical Error at Step:", error.message);
    res.status(500).json({ error: "AI failed to respond.", details: error.message });
  }
});



function calculateSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) { dotProduct += vecA[i] * vecB[i]; }
    return dotProduct;
}

module.exports = router;