from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """
    Central configuration for environment variables
    """

    ENABLE_SCHEDULER: bool = False
    SCAN_INTERVAL_SECONDS: int = 60
    ENVIRONMENT: str = "development"

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

settings = Settings()