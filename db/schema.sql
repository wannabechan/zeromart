-- BzCat 데이터베이스 스키마

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  level VARCHAR(20) NOT NULL DEFAULT 'user', -- 'admin', 'manager', 'user'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  is_first_login BOOLEAN DEFAULT true
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 인증 코드 테이블 (임시 저장, 만료 시간 있음)
CREATE TABLE IF NOT EXISTS auth_codes (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON auth_codes(email);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);

-- 주문 테이블
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  depositor VARCHAR(100) NOT NULL,
  contact VARCHAR(20) NOT NULL,
  expense_type VARCHAR(20), -- 'cash_receipt', 'business', 'none'
  expense_doc VARCHAR(100),
  delivery_date DATE NOT NULL,
  delivery_time VARCHAR(20) NOT NULL,
  delivery_address TEXT NOT NULL,
  detail_address VARCHAR(255),
  order_items JSONB NOT NULL, -- 주문 메뉴 정보
  total_amount INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'confirmed', 'completed', 'cancelled'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_orders_user_email ON orders(user_email);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);

-- admin 사용자 추가 (초기 데이터)
INSERT INTO users (email, level, is_first_login)
VALUES ('bzcatmanager@gmail.com', 'admin', false)
ON CONFLICT (email) DO NOTHING;
