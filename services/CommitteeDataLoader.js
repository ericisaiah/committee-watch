import axios from 'axios';
import xmlParser from 'fast-xml-parser';
import got from 'got';

export default class CommitteeDataLoader {

  constructor(CommitteeEventModel) {
    this.CommitteeEvent = CommitteeEventModel;
  }

  // Load the committee's events and store them so later we can match to
  // their respective video.
  async loadNewEvents(committee) {

    let self = this;
    let committeeFeedId,
        committeeFeedUrl;

    if (committee.type === 'house') {
      committeeFeedUrl = `https://docs.house.gov/Committee/RSS.ashx?Code=${committee.house_committee_id}00`;
    } else {
      committeeFeedId = committee.senate_committee_id;
      // TBD:
      committeeFeedUrl = `https://docs.house.gov/Committee/RSS.ashx?Code=${committee.senate_committee_id}00`;
    }

    // Eventually this will need paginate through the feed -- or scrape
    // committees' websites. For now, just pull the first page of the RSS feed.
    // Also not yet implemented: we'll want to load only the events since the last
    // time we fetched them versus the feed's pubDate.
    const response = await got.get(committeeFeedUrl);
    const jsonFeed = xmlParser.parse(response.body);

    jsonFeed.rss.channel.item.forEach(async (eventItem) => {
      await self.CommitteeEvent.findOneAndUpdate({ eventId: eventItem.guid }, {
        committeeId: committee.thomas_id,
        title: eventItem.title,
        committeeEventUrl: eventItem.link,
        description: eventItem.description,
        publishedDate: eventItem.pubDate
      }, {
        upsert: true
      }).catch((err) => {
        console.log(`Error saving committee data: ${err.message}`);
      });
    });
  }

  getEventsWithoutVideos(committeeId) {
    return this.CommitteeEvent.find({
      committeeId: committeeId,
      youtubeId: null
    });
  }

}
