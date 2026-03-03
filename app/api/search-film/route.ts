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
      url = `http://www.omdbapi.com/?apikey=${apiKey}&i=${encodeURIComponent(imdbID)}&plot=full`;
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

    let detailData = data;

    if (!imdbID) {
      if (!data.Search?.length) {
        return NextResponse.json(
          { error: "No results found" },
          { status: 404 }
        );
      }
      const firstImdbId = data.Search[0].imdbID;
      const detailRes = await fetch(
        `http://www.omdbapi.com/?apikey=${apiKey}&i=${encodeURIComponent(firstImdbId)}&plot=full`
      );
      if (detailRes.ok) {
        detailData = await detailRes.json();
      }
    }

    return NextResponse.json({
      Title: detailData.Title,
      Year: detailData.Year,
      imdbID: detailData.imdbID,
      Plot: detailData.Plot,
      Genre: detailData.Genre,
      Director: detailData.Director,
      Actors: detailData.Actors,
    });
  } catch (error) {
    console.error("Search film error:", error);
    return NextResponse.json(
      { error: "Failed to search film" },
      { status: 500 }
    );
  }
}
