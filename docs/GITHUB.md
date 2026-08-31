# GitHub repository

This project must live in its own repository (recommended name: `TeacherSheet`).

The ChatGPT GitHub connector available in this session can write to an existing repository but cannot create a new repository. After the empty repository exists, the project can be pushed to `main`.

Manual fallback:
```bash
git init -b main
git add .
git commit -m "Initial TeacherSheet production foundation"
git remote add origin git@github.com:YOUR_USER/TeacherSheet.git
git push -u origin main
```
