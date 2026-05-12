import Database from 'better-sqlite3';
const db = new Database('celebrity_graph.sqlite');
console.log(db.prepare('SELECT name, category FROM people').all());
