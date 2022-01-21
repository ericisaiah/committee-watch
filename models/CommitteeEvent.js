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
  eventType: {
    type: String,
    index: true,
    required: true
  },
  meetingDate: {
    type: Date
  },
  closedOrPostponed: {
    type: Boolean,
    required: true,
    default: false
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
  youtubeTitle: {
    type: String
  },
  youtubeDescription: {
    type: String
  },
  presumedVideoId: {
    type: String
  },
  presumedVideoTitle: {
    type: String
  },
  taggedIn: {
    type: String,
    index: true
  },
  lastUpdatedData: {
    type: Date,
    required: true
  }
});

schema.static('taggedLabels', {
  "noEventId": "No event ID on video - exact match found",
  "noVideoMatch": "No video match",
  "tagOK": "Event ID correctly on video",
  "noVideo": "No video expected",
  "presumedVideoMatchFound": "No event ID on video - presumed match found"
});

schema.static('eventTypeLabels', {
  "HHRG": "Hearing",
  "HMTG": "Meeting",
  "HMKP": "Markup"
});

schema.static('youTubeLink', function(videoId) { // Can't use => functions because this won't be bound to document
  if (videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  } else {
    return null;
  }
});

schema.method('taggedStatus', function() { // Can't use =>
  if (this.closedOrPostponed) {
    return this.constructor.taggedLabels.noVideo;
  } else {
    if (!this.taggedIn) {
      if (this.youtubeId) {
        return this.constructor.taggedLabels.noEventId;
      } else if (this.presumedVideoId) {
        return this.constructor.taggedLabels.presumedVideoMatchFound;
      } else {
        return this.constructor.taggedLabels.noVideoMatch;
      }
    } else {
      return this.constructor.taggedLabels.tagOK;
    }
  }
});

export default schema;