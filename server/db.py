"""
Database session management for the AgentTrace server.

Uses SQLAlchemy with a SQLite file (server/agenttrace.db).
Tables are auto-created on first import via ``init_db()``.
"""

from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from .models import Base

# Resolve the DB path relative to THIS file so it always lands in server/
_DB_PATH = Path(__file__).parent / "agenttrace.db"
DATABASE_URL = f"sqlite:///{_DB_PATH}"

# ``check_same_thread=False`` is required for SQLite when using FastAPI's
# async request handling (each request may run in a different thread).
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,  # Set to True to log raw SQL for debugging
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db() -> None:
    """Create all tables if they don't already exist. Safe to call multiple times."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """
    FastAPI dependency that yields a SQLAlchemy session and ensures it is
    closed after each request, even if an exception is raised.

    Usage in a route::

        @app.get("/api/example")
        def example(db: Session = Depends(get_db)):
            ...
    """
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
