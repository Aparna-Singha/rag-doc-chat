# Ask My Doc RAG

Ask My Doc RAG is a document question-answering web application built for a Retrieval-Augmented Generation assignment. A user uploads one document, the app indexes that document through a RAG pipeline, and the chat UI answers questions using only retrieved content from the uploaded file.

For this submission, `PDF`, `TXT`, and `CSV` document flows were tested. The app shows source chunks with answers, answers only from retrieved document context, and says `I could not find this information in the uploaded document.` when the answer is not present in the uploaded file.

## Problem Statement

Many LLM-based chat apps answer from general model knowledge, which can lead to hallucinations when the user wants answers from a specific document. This project solves that problem by letting users upload a `PDF`, `TXT`, or `CSV` file and ask natural-language questions grounded only in that document.

## Features

- Upload a single `PDF`, `TXT`, or `CSV` document from the browser
- Validate supported file types and maximum upload size
- Extract readable text on the server
- Handle `CSV` files by converting rows into readable structured text before chunking
- Split extracted content into retrieval-friendly overlapping chunks
- Generate embeddings using the Gemini API
- Store chunk embeddings in Qdrant
- Fall back to an in-memory vector store during local development when Qdrant is unavailable
- Retrieve relevant chunks using `documentId` filtering so different uploads do not mix
- Ask grounded questions through a chat interface
- Show source chunks under each assistant answer
- Return a fallback answer when the information is not present in the uploaded document

## Demo Screenshots

### CSV Document Question Answering

Shows CSV upload, indexing, retrieval, and answer generation from tabular data.

![CSV question answering](public/screenshots/csv-query.png)

### TXT Document Question Answering

Shows TXT upload, chunking, retrieval, and grounded answer generation.

![TXT question answering](public/screenshots/txt-query.png)

### PDF Document Question Answering

Shows PDF upload, indexing, source chunks, and answer generation.

![PDF question answering](public/screenshots/pdf-query.png)

### Grounded Answer / Hallucination Prevention

When the uploaded document does not contain the answer, the app refuses to guess.

![Grounded refusal](public/screenshots/grounded-refusal.png)

## Tech Stack

- `Next.js` with App Router
- `TypeScript`
- `Tailwind CSS`
- `Gemini API` via `@google/genai`
- `Qdrant` for vector storage
- `pdf-parse` for PDF text extraction
- `Papa Parse` for CSV parsing
- `Docker` for local Qdrant setup

## RAG Pipeline

The application follows this pipeline:

Upload document
-> Extract text
-> Chunk text
-> Create embeddings
-> Store embeddings in vector DB
-> Retrieve relevant chunks
-> Send context to LLM
-> Generate grounded answer

More concretely:

1. The user uploads a supported file.
2. The backend validates the file type and size.
3. The server extracts text based on the file format.
4. The extracted text is split into overlapping chunks.
5. Gemini creates embeddings for each chunk.
6. The chunk embeddings are stored in Qdrant, or in memory during local development if Qdrant is unavailable.
7. When the user asks a question, the app embeds the question and retrieves the top matching chunks for that document only.
8. Only those retrieved chunks are sent to Gemini for answer generation.
9. The app returns the answer plus the source chunks used.

## Supported Files

- `PDF`
- `TXT`
- `CSV`

The upload API accepts these extensions and MIME types:

- `.pdf`
- `.txt`
- `.csv`
- `application/pdf`
- `text/plain`
- `text/csv`
- `application/csv`
- `application/vnd.ms-excel`

## CSV Handling

CSV files are not treated as raw comma-separated strings. The app parses them with a CSV parser and converts each row into structured readable text before chunking. This makes tabular data easier for embeddings, retrieval, and the final LLM answer.

Example transformed row:

```text
Row 1: name: Aparna; marks: 92; subject: DBMS
```

In the current implementation:

- the first row is treated as headers
- empty lines are skipped
- malformed CSV input returns a clean error
- the extracted text includes a columns line plus readable row lines

Example shape:

```text
Columns: name; marks; subject
Row 1: name: Aparna; marks: 92; subject: DBMS
Row 2: name: Lekhana; marks: 88; subject: OS
```

## Chunking Strategy

The chunking module is designed for retrieval quality while keeping chunks readable.

- Target chunk size: `900-1200` characters
- Overlap: `180` characters
- Paragraph-aware splitting is preferred first
- If needed, the chunker falls back to sentence, whitespace, or character-based boundaries
- Empty chunks are skipped

Why overlap helps:

- Important information can sit near the end of one chunk and the beginning of the next
- Overlap reduces the chance that retrieval misses context split across chunk boundaries
- This improves answer grounding for questions that depend on nearby text

## Vector Database

This project uses `Qdrant` as the main vector database.

Current behavior:

- a collection is created automatically if it does not exist
- each stored point contains the vector plus chunk metadata
- retrieval is filtered by `documentId`
- chunks from different uploads are not mixed during search
- very low-confidence retrieval results are discarded before answer generation

Stored chunk metadata includes:

- `documentId`
- `fileName`
- `fileType`
- `chunkIndex`
- `pageNumber` when available
- `text`
- `snippet`

### In-Memory Fallback

An in-memory vector store is also implemented for local development.

Use case:

- local `next dev` testing when Qdrant is not running or not reachable

Limitations:

- not persistent
- cleared when the server restarts
- not suitable for production or Vercel deployment

## Grounded Answering Rules

The chat route uses retrieved chunks only. The answer generator is instructed to:

- answer only from the provided document context
- not use outside knowledge
- not guess
- return `I could not find this information in the uploaded document.` when the answer is not supported by the retrieved context
- return the same fallback answer when retrieval does not find sufficiently relevant chunks

This helps keep answers grounded and assignment-appropriate.

## Environment Variables

Create a `.env.local` file from `.env.example`.

Required and commonly used variables:

```env
GEMINI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION_NAME=
```

The example file in this project also includes:

```env
GEMINI_MODEL=gemini-2.5-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
RAG_TOP_K=5
MAX_FILE_SIZE_MB=10
```

Notes:

- `GEMINI_API_KEY` is required
- `QDRANT_URL` is required for deployed environments and should point to your local Docker instance or Qdrant Cloud cluster
- `QDRANT_API_KEY` is optional unless your Qdrant instance requires authentication
- `QDRANT_COLLECTION_NAME` lets you choose the collection name
- during local development, if `QDRANT_URL` is left blank, the app first tries `http://127.0.0.1:6333`
- `.env.local` should not be committed

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local environment file:

```bash
cp .env.example .env.local
```

3. Add your Gemini API key in `.env.local`.
4. Keep `.env.local` uncommitted. The repository includes `.env.example` for safe sharing.

5. Start Qdrant locally with Docker:

```bash
docker run -d --name ask-my-doc-rag-qdrant -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

The repository also includes a Docker Compose setup, so this works too:

```bash
npm run qdrant:up
```

6. Start the Next.js development server:

```bash
npm run dev
```

7. Open:

```text
http://localhost:3000
```

## Deployment Instructions

### Option 1: Vercel for the Next.js App

This project can be deployed as a fullstack Next.js app on Vercel because the upload and chat logic lives in Next.js API routes and runs on the Node.js runtime.

Steps:

1. Push the project to a GitHub repository.
2. Import the repository into Vercel.
3. Add the environment variables in the Vercel project settings.
4. Connect the deployed app to a reachable Qdrant instance.
5. Deploy.

### Option 2: Qdrant Cloud

For production or demo deployment, use `Qdrant Cloud` instead of local Docker.

You would typically:

1. Create a Qdrant Cloud cluster.
2. Copy the cluster URL into `QDRANT_URL`.
3. Add the cloud API key to `QDRANT_API_KEY` if required.
4. Keep `QDRANT_COLLECTION_NAME` set to the collection you want this project to use.

### Environment Variables for Deployment

At minimum, set:

```env
GEMINI_API_KEY=
QDRANT_URL=
QDRANT_API_KEY=
QDRANT_COLLECTION_NAME=
```

You may also set:

```env
GEMINI_MODEL=
GEMINI_EMBEDDING_MODEL=
RAG_TOP_K=
MAX_FILE_SIZE_MB=
```

### Honest Production Notes

- The in-memory fallback is useful for local development, not production
- Production and Vercel deployments should use a real Qdrant instance
- If `QDRANT_URL` is missing in a deployed environment, the API returns a clear configuration error
- If `GEMINI_API_KEY` is missing, Gemini-powered upload and chat requests return a clear configuration error
- A deployed app should use a persistent Qdrant instance
- The app currently focuses on one uploaded document flow in the UI
- There is no authentication or multi-user document ownership layer in this version

## Assignment Marking Coverage

This section maps the project to common assignment evaluation criteria.

### 1. GitHub Repo

- The codebase is organized and ready to be pushed to GitHub
- The repository contains modular source code, environment examples, Docker setup, and documentation

Note:

- This README does not claim the repository has already been pushed unless you do that separately

### 2. Live Project

- The app is ready for deployment on Vercel with a reachable Qdrant instance

Note:

- A live URL is not included here unless you deploy it separately

### 3. RAG Pipeline

- Implemented end to end
- Upload
- Extraction
- Chunking
- Embeddings
- Vector storage
- Retrieval
- Grounded generation

### 4. Grounded Answers

- Retrieval is filtered by `documentId`
- Only retrieved chunks are sent to the LLM
- The model is explicitly instructed not to use outside knowledge
- The API returns source chunks for transparency

### 5. Code Quality and Documentation

- TypeScript-based implementation
- Modular backend files for extraction, chunking, embeddings, vector storage, retrieval, and answer generation
- Upload and chat APIs separated cleanly
- Frontend connected to real APIs
- README and `.env.example` included

## Project Structure

```text
src/
  app/
    api/
      chat/route.ts
      upload/route.ts
    globals.css
    layout.tsx
    page.tsx
  components/
    ask-my-doc-app.tsx
  lib/
    client/
      upload-document.ts
    rag/
      answer.ts
      chunkText.ts
      embeddings.ts
      extractText.ts
      retrieval.ts
      text.ts
      vectorStore.ts
      extractors/
        csv.ts
        pdf.ts
        txt.ts
    errors.ts
    server-config.ts
    types.ts
    uploads/
      validation.ts
docker-compose.yml
.env.example
README.md
```

## Available Scripts

```bash
npm run dev
npm run build
npm run lint
npm run qdrant:up
npm run qdrant:down
```

## Current Scope

This project intentionally stays within the scope of the assignment:

- one-document upload and questioning flow in the UI
- grounded answer generation from retrieved chunks
- source chunk display for transparency

It does not currently implement:

- user authentication
- multi-document notebooks
- persistent application database for user sessions
- streaming chat responses
- advanced citation formatting beyond source chunk display
