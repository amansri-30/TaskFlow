import mongoose, { Schema, Document } from "mongoose";

export interface IData extends Document {
  key: string;
  value: any;
  createdAt: Date;
  updatedAt: Date;
}

const DataSchema = new Schema<IData>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

const Data = mongoose.models.Data || mongoose.model<IData>("Data", DataSchema);
export default Data;