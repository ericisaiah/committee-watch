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
  meetingDate: {
    type: Date
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
  },
  lastRetrievedVideo: {
    type: Date,
    required: true
  }
});

schema.static('taggedLabels', {
  "noEventId": "No event ID on video",
  "noVideoMatch": "No video match",
  "tagOK": "Event ID correctly on video"
});

schema.method('youTubeLink', function() { // Can't use => functions because this won't be bound to document
  if (this.youtubeId) {
    return `https://www.youtube.com/watch?v=${this.youtubeId}`;
  } else {
    return null;
  }
});

schema.method('taggedStatus', function() { // Can't use =>
  if (!this.taggedIn) {
    if (this.youtubeId) {
      return this.constructor.taggedLabels.noEventId;
    } else {
      return this.constructor.taggedLabels.noVideoMatch;
    }
  } else {
    return this.constructor.taggedLabels.tagOK;
  }
});

export default schema;