import _ from 'lodash';
import mongoose from 'mongoose';
import got from 'got';
import moment from 'moment';

import CommitteeEventSchema from '../models/CommitteeEvent.js';


export default class VideoLoader {

  constructor(apiKey) {
    this.CommitteeEvent = mongoose.model('CommitteeEvent', CommitteeEventSchema);
    this.apiKey = apiKey;
  }

  /**
   * Each committee's hearings' YouTube videos should be 'tagged' with the LOC
   * event ID in the title or description fields in the format "EventID=12345" or "Event ID=12345"
   */
  async loadAndMatch(committeeId, youtubeChannelId) {
    
    const EVENT_ID_REGEX = /Event\s?ID\s?\=\s?(\d+)/i;

    const videos = await this.loadVideos(youtubeChannelId);

    if (!videos) {
      return;
    }

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

  /**
   * For all the committee events missing videos, search for videos in a
   * general YouTube video search and assign the first hit as the presumed
   * match.
   */
  async matchMissingVideos(committeeId, youtubeChannelId) {

    const committeeEvents = await this.CommitteeEvent.find({
      committeeId: committeeId,
      closedOrPostponed: false,
      youtubeId: null,
      presumedVideoId: null
    });

    const searchPromises = committeeEvents.map(async (event) => {
      const videoSearchResult = await this.searchVideo(youtubeChannelId, event.title, event.meetingDate);

      if (videoSearchResult) {
        try {
          await this.CommitteeEvent.findOneAndUpdate({ eventId: event.eventId }, {
            presumedVideoId: videoSearchResult.videoId,
            presumedVideoTitle: videoSearchResult.title
          });
        } catch(err) {
          console.log(`Error saving presumed video id and title: ${err.message}: "${videoSearchResult.title}" (${videoSearchResult.videoId}) for Event ID ${event.eventId}`);
        }
      }
    });

    return Promise.all(searchPromises);
  }

  /**
   * Eventually refactor to cache and load a diff based on a last-retrieved timestamp
   * and conditionally retrieve using ETag
   */
  async loadVideos(youtubeChannelId) {

    const channelPlaylistsUrl = 'https://www.googleapis.com/youtube/v3/channels';
    const playlistParams = {
      key: this.apiKey,
      id: youtubeChannelId,
      part: 'contentDetails',
    };

    const playlistResponse = await got.get(channelPlaylistsUrl, {
      searchParams: playlistParams,
      responseType: 'json'
    }).catch((err) => {
      console.log(`Error getting channel for Channel ID ${youtubeChannelId}: ${err.message}`);
    });

    if (!playlistResponse) {
      return;
    }

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
        console.log(`Error getting playlist items for Channel ID ${youtubeChannelId} (Playlist ID: ${uploadsPlaylistId}): ${err.message}`);
      });

      if (!videosResponse) {
        return;
      }

      allVideos = allVideos.concat(videosResponse.body.items);
      nextPageToken = videosResponse.body.nextPageToken;
      currentPage++;
    }

    return allVideos;
  }

  async searchVideo(youtubeChannelId, title, eventDate) {
    const searchUrl = 'https://www.googleapis.com/youtube/v3/search';
    const searchParams = {
      key: this.apiKey,
      part: 'snippet',
      type: 'video',
      channelId: youtubeChannelId,
      publishedAfter: moment(eventDate).subtract(4, 'weeks').toISOString(),
      publishedBefore: moment(eventDate).add(4, 'weeks').toISOString(),
      fields: 'items(snippet(title,description),id(videoId))',
      q: title
    };

    const searchResponse = await got.get(searchUrl, {
      searchParams: searchParams,
      responseType: 'json'
    }).catch((err) => {
      console.log(`Error searching for '${title}' for Channel ID ${youtubeChannelId}: ${err.message}`);
    });

    if (searchResponse && searchResponse.body.items.length > 0) {
      return {
        videoId: searchResponse.body.items[0].id.videoId,
        title: searchResponse.body.items[0].snippet.title
      };
    } else {
      return null;
    }
  }
}