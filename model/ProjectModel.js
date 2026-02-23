const mongoose = require('mongoose');

const ProjectSchema = new mongoose.Schema({
    name: { 
        type: String, 
        required: true 
    },
    type: { 
        type: String, 
        enum: ['zip', 'github'], 
        default: 'zip' 
    },
    fileCount: { 
        type: Number, 
        default: 0 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    }
});

const ProjectModel = mongoose.model('ProjectModel', ProjectSchema);

module.exports = ProjectModel;