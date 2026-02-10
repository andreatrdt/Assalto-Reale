import asyncio
from assalto_app_ai import AssaltoRealeApp

async def main():
    app = AssaltoRealeApp()
    await app.run()

if __name__ == "__main__":
    asyncio.run(main())
