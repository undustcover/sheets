const argon2 = require('argon2');
const hash = '$argon2id$v=19$m=65536,t=3,p=4$DDlaN5gDCXlLuH/stMBXEQ$vnzGfL91x+eYlfEGlTZl+6QYQ3CYlQ2su7JuoYIr4/Y';
(async () => {
  try {
    const ok = await argon2.verify(hash, 'admin');
    console.log('verify admin:', ok);
    const ok2 = await argon2.verify(hash, 'admin123');
    console.log('verify admin123:', ok2);
  } catch (e) {
    console.error('Error verifying:', e);
    process.exitCode = 1;
  }
})();