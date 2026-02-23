const mongoose = require('mongoose');

const CodeSchema = new mongoose.Schema({
    projectId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Project',
        required: true 
    },
    fileName: String,
    content: String,
    embedding: [Number],
    uploadedAt: { type: Date, default: Date.now }
});

const CodeModel = mongoose.model('Code', CodeSchema);
module.exports = CodeModel;