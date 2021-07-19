import _ from 'lodash';
import mongoose from 'mongoose';
import CSVWriter from 'csv-writer';
import fs from 'fs';
import google from '@googleapis/sheets';
import moment from 'moment';

import CommitteeEventSchema from '../models/CommitteeEvent.js';
import CommitteeDataLoader from './CommitteeDataLoader.js';


export default class GdocWriter {

  constructor(options) {
    this.committeeList = options.committeeList;
    this.apiKey = options.googleApiKey;
    this.gSheetId = options.googleSheetId;
    this.gSpreadsheetId = options.googleSpreadsheetId;
    this.gServiceAccountKeyPath = options.googleServiceAccountKeyPath;

    this.CommitteeEvent = mongoose.model('CommitteeEvent', CommitteeEventSchema);

    this.TAGGED_STATUS_COLUMN_INDEX = 5;
    this.CSV_FOLDER = 'tmp/';
    this.CSV_PATH = this.CSV_FOLDER + 'export.csv';

    try {
      fs.mkdirSync(this.CSV_FOLDER);
    } catch(err) {
      if (err.code !== 'EEXIST') {
        console.log(`Error making temp directory: ${err.message}`);
        process.exit(1);
      }
    }

    try {
      fs.rmSync(this.CSV_PATH);
    } catch(err) {
      if (err.code !== 'ENOENT') {
        console.log(`Error deleting previous export: ${err.message}`)
      }
    }
  }

  async exportAndUploadToGdoc() {
    await this.exportToCSV();

    let csvFileContents;

    try {
      csvFileContents = fs.readFileSync(this.CSV_PATH);
    } catch(err) {
      console.log(`Error loading CSV: ${err.message}`);
      process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: this.gServiceAccountKeyPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    let updateRequestBody = {
      key: this.apiKey,
      spreadsheetId: this.gSpreadsheetId,
      resource: {
        requests: [{
          pasteData: {
            coordinate: {
              sheetId: this.gSheetId,
              rowIndex: '0',
              columnIndex: '0'
            },
            data: csvFileContents.toString(),
            type: 'PASTE_VALUES',
            delimiter: ','
          }
        }]
      }
    };

    const sheets = google.sheets({
      version: 'v4',
      auth: auth
    });

    try {

      return sheets.spreadsheets.batchUpdate(updateRequestBody)
        .then(() => {
          return true;
        })
        .catch((err) => {
          console.log(`Error uploading to Google Sheets: ${err.message}`);
          return false
        });

    } catch(err) {
      console.log(`Error uploading to Google Sheets: ${err.message}`);
      process.exit(1);
    }
  }

  async exportToCSV() {
    const committeeDataLoader = new CommitteeDataLoader()
    const events = await committeeDataLoader.getAllEvents();

    const headings = [
      'Chamber',
      'Committee Name',
      'Event ID',
      'Event Date',
      'Event Type',
      'Title',
      'Status', // Make sure this is 5th column (i.e. == TAGGED_STATUS_COLUMN_INDEX)
      'YouTube Link',
      'Event Link',
      'Published Date',
    ];

    const csvWriter = new CSVWriter.createArrayCsvWriter({
      path: this.CSV_PATH,
      alwaysQuote: true,
      append: true
    });

    await csvWriter.writeRecords([headings]);

    const writeRecordsPromises = events.map((event) => {

      let columns = [];

      const committee = _.find(this.committeeList, (committee) => {
        return committee.thomas_id === event.committeeId;
      });

      columns.push(committee.type);
      columns.push(committee.name);
      columns.push(event.eventId);
      columns.push(moment(event.meetingDate).format('YYYY-MM-DD'));
      columns.push(this.CommitteeEvent.eventTypeLabels[event.eventType]);
      columns.push(event.title);
      columns.push(event.taggedStatus());
      columns.push(event.youTubeLink());
      columns.push(event.committeeEventUrl);
      columns.push(moment(event.publishedDate).format('YYYY-MM-DD'));

      return csvWriter.writeRecords([columns])
        .catch((err) => {
          console.log(`Error writing CSV: ${err.message}`);
          process.exit(1);
        });
    });

    return Promise.all(writeRecordsPromises);
  }

}