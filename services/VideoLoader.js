import mongoose from 'mongoose';
import fs from 'fs';
import YAML from 'yaml';
import got from 'got';

import CommitteeEventSchema from '../models/CommitteeEvent.js';


export default class VideoLoader {

  constructor(apiKey) {
    this.CommitteeEvent = mongoose.model('CommitteeEvent', CommitteeEventSchema);
    this.apiKey = apiKey;

    const idsFile = fs.readFileSync('./config/sources/youtube_ids.yml', 'utf8');
    this.channelIds = YAML.parse(idsFile);
  }

  // Each committee's hearings' YouTube videos should be 'tagged' with the LOC
  // event ID in the title or description fields in the format "(EventID=12345)"
  async loadAndMatch(committeeId) {
    
    const EVENT_ID_REGEX = /EventID\=(\d+)/i;

    const videos = await this.loadVideos(committeeId);

    const videoPromises = videos.map(async (video) => {

      let parsedEventId,
          taggedIn;

      const titleMatches = video.snippet.title.match(EVENT_ID_REGEX);
      if (titleMatches && titleMatches.length > 1) {
        parsedEventId = titleMatches[1];
        taggedIn = 'title';
      } else {
        const descMatches = video.snippet.description.match(EVENT_ID_REGEX);
        if (descMatches && descMatches.length > 1) {
          parsedEventId = descMatches[1];
          taggedIn = 'description';
        }
      }

      let eventUpdateAttributes = {
        youtubeId: video.snippet.resourceId.videoId,
        youtubeTitle: video.snippet.title,
        youtubeDescription: video.snippet.description,
        taggedIn: null
      };

      // For now, taggedIn !== null is the same as ID !== null, but we can also
      // match video titles to events titles, which would mean that we could
      // have a video's ID without the EventID being present in the title or
      // description. We could also fuzzy match titles in the future.

      if (parsedEventId) {
        eventUpdateAttributes.taggedIn = taggedIn;
        await this.CommitteeEvent.findOneAndUpdate({ eventId: parsedEventId }, eventUpdateAttributes);
      } else {
        await this.CommitteeEvent.findOneAndUpdate({ title: video.snippet.title }, eventUpdateAttributes);
      }
    });

    return Promise.all(videoPromises);
  }

  // Eventually refactor to cache and load a diff based on a last-retrieved timestamp
  // and conditionally retrieve using ETag. We'll also need to paginate through
  // the committee's channel's videos. For now, just get the first page of results.
  async loadVideos(committeeId) {

    const channelPlaylistsUrl = 'https://www.googleapis.com/youtube/v3/channels';
    const playlistParams = {
      key: this.apiKey,
      id: this.channelIds[committeeId],
      part: 'contentDetails',
    };

    const playlistResponse = await got.get(channelPlaylistsUrl, {
      searchParams: playlistParams,
      responseType: 'json'
    });
    const uploadsPlaylistId = playlistResponse.body.items[0].contentDetails.relatedPlaylists.uploads;

    const videosBaseUrl = 'https://www.googleapis.com/youtube/v3/playlistItems';

    const videosParams = {
      key: this.apiKey,
      playlistId: uploadsPlaylistId,
      part: 'snippet',
      fields: 'items(snippet(title,description,resourceId(videoId)))',
      maxResults: 50
    };

    const videosResponse = await got.get(videosBaseUrl, {
      searchParams: videosParams,
      responseType: 'json'
    });
    
    return videosResponse.body.items;
  }
}