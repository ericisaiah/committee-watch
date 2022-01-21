import mongoose from 'mongoose';
import xmlParser from 'fast-xml-parser';
import got from 'got';
import moment from 'moment';

import CommitteeEventSchema from '../models/CommitteeEvent.js';


export default class CommitteeDataLoader {

  constructor() {
    this.CommitteeEvent = mongoose.model('CommitteeEvent', CommitteeEventSchema);
  }

  // Load the committee's events and store them so later we can match to
  // their respective video.
  async loadNewEvents(committee) {

    const self = this;
    let committeeId;

    if (committee.thomas_id.match(/^\D+$/)) {
      committeeId = `${committee.house_committee_id}00`;
    } else {
      // TODO: Deal with subcommittees
      throw "Subcommittees not yet supported";
    }

    const committeeFeedUrl = `https://docs.house.gov/Committee/RSS.ashx?Code=${committeeId}`;

    // Eventually this will need paginate through the feed -- or scrape
    // committees' websites. For now, just pull the first page of the RSS feed.
    // Also not yet implemented: we'll want to load only the events since the last
    // time we fetched them versus the feed's pubDate.
    const response = await got.get(committeeFeedUrl);
    const jsonFeed = xmlParser.parse(response.body, {
      ignoreAttributes: false,
      parseAttributeValue: true
    });

    try {
      jsonFeed.rss.channel.item.forEach(async (eventItem) => {

        let parsedMeetingDate,
            parsedPublishedDate,
            parsedClosedOrPostponedStatus;

        try {
          parsedMeetingDate = moment(eventItem.description.match(/Meeting Date\:\s(\w+\,\s\w+\s\d+\,\s\d+\s\d+\:\d+\s\w{2})/)[0]);
        } catch(err) {
          console.log(`Error parsing meeting date: ${err.message} - ${eventItem.description}`);
        }

        try {
          parsedPublishedDate = moment(eventItem.pubDate.match(/([^\(\)]+)(\s\(\w+\))?/)[0]);
        } catch(err) {
          parsedPublishedDate = eventItem.pubDate;
          console.log(`Error parsing published date: ${err.message} - ${eventItem.pubDate}`);
        }

        // If this event is in the future, there will be no video unless we've time traveled
        if (parsedMeetingDate && parsedMeetingDate > moment()) {
          return;
        }

        try {
          parsedClosedOrPostponedStatus = eventItem.title.match(/\(Closed\)/i) !== null;
          if (!parsedClosedOrPostponedStatus) {
            parsedClosedOrPostponedStatus = eventItem.title.match(/Postponed/i) !== null;
          }
        } catch(err) {
          parsedClosedOrPostponedStatus = false;
          console.log(`Error parsing closed or postponed status: ${err.message} - ${eventItem.title}`);
        }

        // Grab the meta data for the event
        const meetingXml = await got.get(eventItem.enclosure['@_url'])
          .then((response) => {
            return xmlParser.parse(response.body, {
              ignoreAttributes: false,
              parseAttributeValue: true
            });
          })
          .catch((err) => {
            console.log(`Error loading meeting XML for ${eventItem.guid}: ${err.message}`);
          });

        await self.CommitteeEvent.findOneAndUpdate({ eventId: eventItem.guid }, {
          committeeId: committee.thomas_id,
          eventType: meetingXml['committee-meeting']['@_meeting-type'],
          closedOrPostponed: parsedClosedOrPostponedStatus,
          title: this.normalizeTitle(eventItem.title),
          committeeEventUrl: eventItem.link,
          description: eventItem.description,
          meetingDate: parsedMeetingDate,
          publishedDate: parsedPublishedDate,
          lastUpdatedData: Date.now()
        }, {
          upsert: true
        }).catch((err) => {
          console.log(`Error saving committee data (Committee ID ${committee.thomas_id}): ${err.message}`);
        });
      });
    } catch(err) {
      console.log(`Error parsing committee data (Committee ID ${committee.thomas_id}): ${err.message}`);
    }
  }

  getAllEvents() {
    return this.CommitteeEvent.find()
      .sort('committeeId -meetingDate');
  }

  // Hearing titles inconsistently use quotes and periods.
  // If they have these, then remove.
  normalizeTitle(title) {
    if (title[0] === '“' || title[0] === '"') {
      title = title.substring(1);
    }
    if (title[title.length - 1] === '”' || title[title.length - 1] === '"') {
      title = title.substring(0, title.length - 1);
    }
    if (title[title.length - 1] === '.') {
      title = title.substring(0, title.length - 1);
    }

    return title;
  }

}
