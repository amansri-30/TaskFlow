"use client";
import axios from "axios";

async function GetQuotes() {
  try {
    const response = await axios.get("/api/quotes");
    const data = response.data;
    return data.quote;
  } catch (error) {
    console.error(error);
    return "An error occurred while fetching the quote.";
  }
};

export default GetQuotes;
