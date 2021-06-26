import mongoose from 'mongoose';

const schema = mongoose.Schema({
  committeeId: {
    type: String,
    index: true,
    required: true
  },
  eventId: {
    type: Number,
    index: true,
    unique: true,
    required: true
  },
  publishedDate: {
    type: Date,
    required: true
  },
  title: {
    type: String,
    index: true,
    trim: true,
    required: true
  },
  committeeEventUrl: {
    type: String,
    index: true,
    unique: true
  },
  youtubeId: {
    type: String
  },
  youtubeTitle: String,
  youtubeDescription: String,
  taggedIn: {
    type: String,
    index: true
  }
});

export default schema;