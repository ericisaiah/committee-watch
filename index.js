import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import YAML from 'yaml';
import got from 'got';
import CommitteeEventSchema from './models/CommitteeEvent.js';
import CommitteeDataLoader from './services/CommitteeDataLoader.js';
import VideoLoader from './services/VideoLoader.js';

dotenv.config();

const app       = express();
const port      = 3000;

const CommitteeEvent = mongoose.model('CommitteeEvent', CommitteeEventSchema);

// Eventually run this every X hours
// cron.schedule('* * * * *', runProofOfConcept);

const runProofOfConcept = async () => {

  try {
    await mongoose.connect(process.env.DATABASE_URL, {
      useNewUrlParser: true,
      useFindAndModify: false
    });
  } catch (err) {
    console.log(`Error connecting to database: ${err.message}`);
  }

  console.log(`Loading...`);

  // Eventually let's pull from the full committee list
  // const sourcesFile = fs.readFileSync('./config/sources/external.yml', 'utf8');
  // const sources = YAML.parse(sourcesFile);

  // For now, use 1 committee sample:
  const exampleCommitteeListFile = fs.readFileSync('./config/sources/example_committee_list.yml', 'utf8');
  const committeeList = YAML.parse(exampleCommitteeListFile);

  // Eventually parse the full committee list
  // const committeeList = YAML.parse(response.body);

  const committeePromises = committeeList.map(async (committee) => {
      
    const committeeId = committee.thomas_id;
    const committeeName = committee.name;

    console.log(`Getting list of events for ${committeeName}...`);

    const committeeLoader = new CommitteeDataLoader(CommitteeEvent);
    await committeeLoader.loadNewEvents(committee);
    
    console.log("Committee event data loaded.");
    console.log(`Getting list of videos for ${committeeName} and matching them to events...`);

    const videoLoader = new VideoLoader(CommitteeEvent, process.env.YOUTUBE_API_KEY);
    await videoLoader.loadAndMatch(committeeId);

    const eventsWithoutVideo = await committeeLoader.getEventsWithoutVideos(committeeId); 

    console.log(`\n\nMissing videos for ${committeeName}:\n`);

    eventsWithoutVideo.forEach((event) => {
      console.log(`"${event.eventId}", "${event.title}", "${event.committeeEventUrl}"`);
    });
  });

  await Promise.all(committeePromises);
  process.exit();
}

// As a proof of concept, a server is pointless, and this could even be a lambda
// function, but eventually this should be run as a cron job to refresh data every x hours.
// app.listen(port, runProofOfConcept);
runProofOfConcept();