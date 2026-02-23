var express = require("express");
var router = express.Router();
const mongoose = require("mongoose");
require("dotenv").config();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const Project = require('../model/ProjectModel'); 

router.get('/history', async (req, res) => {
    try {
        const history = await Project.aggregate([
            { $sort: { createdAt: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: "chatmessages",    
                    localField: "_id",      
                    foreignField: "projectId", 
                    as: "messages"
                }
            },
        ]);

        res.json({
            success: true,
            count: history.length,
            data: history
        });

    } catch (error) {
        console.error("Hierarchy Fetch Error:", error.message);
        res.status(500).json({ 
            success: false, 
            error: "Failed to fetch project-based history" 
        });
    }
});



router.get('/system-status', async (req, res) => {
    const status = {
        backend: { name: "Backend", status: "Healthy", latency: 2 },
        vectorDb: { name: "Vector DB", status: "Checking...", latency: 0 },
        aiEngine: { name: "OpenRouter", status: "Waiting...", latency: 0 }
    };

    try {
        const dbStart = Date.now();
        if (mongoose.connection.readyState === 1) {
            status.vectorDb.status = "Healthy";
            status.vectorDb.latency = Date.now() - dbStart;
        } else {
            throw new Error("Mongoose Disconnected");
        }

            const aiStart = Date.now();
            try {
                
                const authResponse = await fetch("https://openrouter.ai/api/v1/auth/key", {
                    method: "GET",
                    headers: {
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    }
                });

                const authData = await authResponse.json();

                if (authResponse.status === 200) {
                    if (authData.data.usage > authData.data.limit && authData.data.limit !== null) {
                        status.aiEngine.status = "No Credits";
                    } else {
                        status.aiEngine.status = "Healthy";
                    }
                } else {
                    status.aiEngine.status = "Unauthorized";
                }
                
                status.aiEngine.latency = Date.now() - aiStart;

            } catch (aiErr) {
                status.aiEngine.status = "Connection Error";
                console.error("OpenRouter Check Failed:", aiErr.message);
            }

        res.json({ success: true, systems: status });

    } catch (error) {
        status.vectorDb.status = "Offline";
        res.status(503).json({ success: false, systems: status, error: error.message });
    }
});


module.exports = router;