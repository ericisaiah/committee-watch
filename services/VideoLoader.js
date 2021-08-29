import _ from 'lodash';
import mongoose from 'mongoose';
import got from 'got';

import CommitteeEventSchema from '../models/CommitteeEvent.js';


export default class VideoLoader {

  constructor(apiKey) {
    this.CommitteeEvent = mongoose.model('CommitteeEvent', CommitteeEventSchema);
    this.apiKey = apiKey;
  }

  // Each committee's hearings' YouTube videos should be 'tagged' with the LOC
  // event ID in the title or description fields in the format "EventID=12345" or "Event ID=12345"
  async loadAndMatch(committeeId, youtubeId) {
    
    const EVENT_ID_REGEX = /Event\s?ID\s?\=\s?(\d+)/i;

    const videos = await this.loadVideos(youtubeId);

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

      // taggedIn !== null is the same as event ID !== null
      if (parsedEventId) {
        eventUpdateAttributes.taggedIn = taggedIn;
        await this.CommitteeEvent.findOneAndUpdate({ eventId: parsedEventId }, eventUpdateAttributes);
      } else {
        // Check for an exact title match between a committee's events and titles
        const updatedDoc = await this.CommitteeEvent.findOneAndUpdate({
          committeeId: committeeId,
          title: video.snippet.title
        }, eventUpdateAttributes);

        // Check to see if the title of this video contains ANY of the committee's event titles
        if (!updatedDoc) {
          let committeeEvents = await this.CommitteeEvent.find({ committeeId: committeeId });
          const checkAllCommitteeEventsPromises = committeeEvents.map(async (committeeEvent) => {
            try {
              if (video.snippet.title.match(committeeEvent.title)) {
                await this.CommitteeEvent.findOneAndUpdate({
                  eventId: committeeEvent.eventId
                }, eventUpdateAttributes);
              }
            } catch (err) {
              console.log(`Error matching title: ${err.message}: "${committeeEvent.title}" in "${video.snippet.title}"`)
            }
          });
          await Promise.all(checkAllCommitteeEventsPromises);
        }
      }
    });

    return Promise.all(videoPromises);
  }

  // Eventually refactor to cache and load a diff based on a last-retrieved timestamp
  // and conditionally retrieve using ETag. We'll also need to paginate through
  // the committee's channel's videos. For now, just get the first page of results.
  async loadVideos(youtubeId) {

    const channelPlaylistsUrl = 'https://www.googleapis.com/youtube/v3/channels';
    const playlistParams = {
      key: this.apiKey,
      id: youtubeId,
      part: 'contentDetails',
    };

    const playlistResponse = await got.get(channelPlaylistsUrl, {
      searchParams: playlistParams,
      responseType: 'json'
    }).catch((err) => {
      console.log(`Error getting channel for Channel ID ${youtubeId}: ${err.message}`);
    });
    const uploadsPlaylistId = playlistResponse.body.items[0].contentDetails.relatedPlaylists.uploads;

    const videosBaseUrl = 'https://www.googleapis.com/youtube/v3/playlistItems';

    let allVideos = [];
    let pagesToGoBack = 15 // Only go back 50 x 15 = 750 videos back, if they exist
    let currentPage = 0;
    let nextPageToken = null;

    while (currentPage === 0 || (nextPageToken && currentPage < pagesToGoBack )) {

      const videosParams = {
        key: this.apiKey,
        playlistId: uploadsPlaylistId,
        part: 'snippet',
        fields: 'nextPageToken,items(snippet(title,description,resourceId(videoId)))',
        maxResults: 50,
        pageToken: nextPageToken
      };

      const videosResponse = await got.get(videosBaseUrl, {
        searchParams: videosParams,
        responseType: 'json'
      }).catch((err) => {
        console.log(`Error getting playlist items for ${committeeId} (Playlist ID: ${uploadsPlaylistId}): ${err.message}`);
      });

      allVideos = allVideos.concat(videosResponse.body.items);
      nextPageToken = videosResponse.body.nextPageToken;
      currentPage++;
    }

    return allVideos;
  }
}