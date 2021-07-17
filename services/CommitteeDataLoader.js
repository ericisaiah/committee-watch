
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
    const jsonFeed = xmlParser.parse(response.body);

    try {
      jsonFeed.rss.channel.item.forEach(async (eventItem) => {

        let parsedMeetingDate,
            parsedPublishedDate;

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

        await self.CommitteeEvent.findOneAndUpdate({ eventId: eventItem.guid }, {
          committeeId: committee.thomas_id,
          title: eventItem.title,
          committeeEventUrl: eventItem.link,
          description: eventItem.description,
          meetingDate: parsedMeetingDate,
          publishedDate: parsedPublishedDate,
          lastRetrievedVideo: Date.now()
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
    return this.CommitteeEvent.find();
  }

}
