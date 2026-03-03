import { NextResponse } from "next/server";

type SearchBody = {
  title?: string;
  year?: string;
  imdbID?: string;
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OMDB_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OMDB API key is not configured" },
        { status: 500 }
      );
    }

    const body: SearchBody = await request.json();
    const { title, year, imdbID } = body;

    let url: string;

    if (imdbID) {
      url = `http://www.omdbapi.com/?apikey=${apiKey}&i=${encodeURIComponent(imdbID)}`;
    } else {
      const searchTitle = title ?? "";
      const searchYear = year ?? "";
      url = `http://www.omdbapi.com/?apikey=${apiKey}&s=${encodeURIComponent(searchTitle)}&y=${encodeURIComponent(searchYear)}`;
    }

    const res = await fetch(url);

    if (!res.ok) {
      return NextResponse.json(
        { error: `OMDB API request failed: ${res.status} ${res.statusText}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (data.Response === "False") {
      return NextResponse.json(
        { error: data.Error ?? "No results found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Search film error:", error);
    return NextResponse.json(
      { error: "Failed to search film" },
      { status: 500 }
    );
  }
}
