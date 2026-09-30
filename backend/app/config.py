from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    """
    Central configuration for environment variables
    """

    ENABLE_SCHEDULER: bool = False
    SCAN_INTERVAL_SECONDS: int = 60
    ENVIRONMENT: str = "development"
    GOOGLE_MAPS_API_KEY: str = ""
    GITHUB_PAT: str = ""
    GITHUB_OWNER: str = "abodell"
    GITHUB_REPO: str = "tee-time-notifier"
    FOREUP_USERNAME: str = ""
    FOREUP_PASSWORD: str = ""
    FREE_LIFETIME_ALERT_LIMIT: int = 3
    # An alert only counts toward the lifetime cap once it's survived this long.
    # Deleting a mistaken/test alert shortly after creating it shouldn't cost
    # a free user one of their 3 lifetime slots.
    FREE_LIFETIME_ALERT_GRACE_HOURS: int = 36

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"

settings = Settings()