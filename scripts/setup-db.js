/**
 * 데이터베이스 초기 설정 스크립트
 * 실행: node scripts/setup-db.js
 */

const { sql } = require('@vercel/postgres');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  try {
    console.log('🔧 데이터베이스 설정 시작...');
    
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    
    // SQL 문을 분리하여 실행
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    
    for (const statement of statements) {
      await sql.query(statement);
      console.log('✓ SQL 실행 완료');
    }
    
    console.log('✅ 데이터베이스 설정 완료!');
  } catch (error) {
    console.error('❌ 데이터베이스 설정 실패:', error);
    process.exit(1);
  }
}

setupDatabase();
