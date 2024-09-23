import { Schema } from 'mongoose';

import { dbserver } from '../../libs/db.connect';

export class IntegrationRaw {
  _id?: string;
  integration?: string;
  number?: string;
  token?: string;
  webVersion?: string;
}

const integrationSchema = new Schema<IntegrationRaw>({
  _id: { type: String, _id: true },
  integration: { type: String, required: true },
  number: { type: String, required: true },
  token: { type: String, required: true },
  webVersion: { type: String, required: false },
});

export const IntegrationModel = dbserver?.model(IntegrationRaw.name, integrationSchema, 'integration');
export type IntegrationModel = typeof IntegrationModel;
