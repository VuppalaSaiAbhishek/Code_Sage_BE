const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema({
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProjectModel' },
    role: { type: String, enum: ['user', 'assistant'] },
    content: { type: String },
    sources: [{
        fileName: String,
        codeSnippet: String,
        lineRange: String
    }],
    createdAt: { type: Date, default: Date.now }
});

// THIS IS THE IMPORTANT LINE:
module.exports = mongoose.models.ChatMessage || mongoose.model('ChatMessage', ChatMessageSchema);