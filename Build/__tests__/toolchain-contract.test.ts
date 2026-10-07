import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { describe, it } from 'node:test';
import ts from 'typescript';

const RE_INVALID_ASSIGNMENT = /TS2322: Type 'string' is not assignable to type 'number'/;

describe('TypeScript toolchain contract', () => {
  it('keeps the JavaScript Compiler API available to runtime consumers', () => {
    const source = ts.createSourceFile(
      'fixture.ts',
      'const answer: number = 42;',
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS
    );
    assert.equal(source.statements.length, 1);
    const statement = source.statements[0];
    assert.ok(ts.isVariableStatement(statement));
    const declaration = statement.declarationList.declarations[0];
    assert.ok(ts.isIdentifier(declaration.name));
    assert.equal(declaration.name.text, 'answer');
    assert.equal(declaration.type?.kind, ts.SyntaxKind.NumberKeyword);
  });

  it('checks valid fixtures and reports assignment errors through the native compiler CLI', () => {
    const compilerPackagePath = require.resolve('typescript-compiler/package.json');
    const compilerPackage: { bin: { tsc: string } } = JSON.parse(
      fs.readFileSync(compilerPackagePath, 'utf8')
    );
    const compilerPath = path.resolve(path.dirname(compilerPackagePath), compilerPackage.bin.tsc);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mirrrule-toolchain-'));
    const fixturePath = path.join(directory, 'fixture.ts');
    const checkFixture = () => spawnSync(
      process.execPath,
      [compilerPath, '--noEmit', '--strict', '--pretty', 'false', fixturePath],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30000,
      }
    );

    try {
      fs.writeFileSync(fixturePath, 'const answer: number = 42;\n');
      const valid = checkFixture();
      assert.ifError(valid.error);
      assert.equal(valid.status, 0, valid.stderr || valid.stdout);

      fs.writeFileSync(fixturePath, 'const answer: number = "wrong";\n');
      const invalid = checkFixture();
      const diagnostic = invalid.stdout + invalid.stderr;
      assert.ifError(invalid.error);
      assert.equal(invalid.signal, null, diagnostic);
      assert.notEqual(invalid.status, 0, diagnostic);
      assert.match(diagnostic, RE_INVALID_ASSIGNMENT);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
