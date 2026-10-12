//! A non-exportable AndroidKeyStore HMAC key derives the SQLCipher key.
//! Derivation is domain-separated and deterministic across process restarts.
use super::Result;
use jni::{
    objects::{JByteArray, JObject, JValue},
    JNIEnv, JavaVM,
};
fn with_env<T>(run: impl FnOnce(&mut JNIEnv<'_>) -> Result<T>) -> Result<T> {
    let context = ndk_context::android_context();
    let vm = unsafe { JavaVM::from_raw(context.vm().cast())? };
    let mut env = vm.attach_current_thread()?;
    let result = run(&mut env);
    if env.exception_check()? {
        env.exception_clear()?;
        return Err("AndroidKeyStore is unavailable; library remains closed".into());
    }
    result
}
fn store<'a>(env: &mut JNIEnv<'a>) -> Result<JObject<'a>> {
    let provider = env.new_string("AndroidKeyStore")?;
    let store = env
        .call_static_method(
            "java/security/KeyStore",
            "getInstance",
            "(Ljava/lang/String;)Ljava/security/KeyStore;",
            &[JValue::Object(&provider)],
        )?
        .l()?;
    env.call_method(
        &store,
        "load",
        "(Ljava/security/KeyStore$LoadStoreParameter;)V",
        &[JValue::Object(&JObject::null())],
    )?;
    Ok(store)
}
pub fn create(id: &str) -> Result<()> {
    with_env(|env| {
        let alias = env.new_string(format!("inkism.storage.{id}"))?;
        let store = store(env)?;
        if env
            .call_method(
                &store,
                "containsAlias",
                "(Ljava/lang/String;)Z",
                &[JValue::Object(&alias)],
            )?
            .z()?
        {
            return Err("mobile key already exists".into());
        }
        let algorithm = env.new_string("HmacSHA256")?;
        let provider = env.new_string("AndroidKeyStore")?;
        let generator = env
            .call_static_method(
                "javax/crypto/KeyGenerator",
                "getInstance",
                "(Ljava/lang/String;Ljava/lang/String;)Ljavax/crypto/KeyGenerator;",
                &[JValue::Object(&algorithm), JValue::Object(&provider)],
            )?
            .l()?;
        // KeyProperties.PURPOSE_SIGN = 4. HMAC-SHA256 implies SHA-256 digest.
        let builder = env.new_object(
            "android/security/keystore/KeyGenParameterSpec$Builder",
            "(Ljava/lang/String;I)V",
            &[JValue::Object(&alias), JValue::Int(4)],
        )?;
        env.call_method(
            &builder,
            "setKeySize",
            "(I)Landroid/security/keystore/KeyGenParameterSpec$Builder;",
            &[JValue::Int(256)],
        )?;
        let spec = env
            .call_method(
                &builder,
                "build",
                "()Landroid/security/keystore/KeyGenParameterSpec;",
                &[],
            )?
            .l()?;
        env.call_method(
            &generator,
            "init",
            "(Ljava/security/spec/AlgorithmParameterSpec;)V",
            &[JValue::Object(&spec)],
        )?;
        env.call_method(&generator, "generateKey", "()Ljavax/crypto/SecretKey;", &[])?;
        Ok(())
    })
}
pub fn read(id: &str) -> Result<Vec<u8>> {
    with_env(|env| {
        let store = store(env)?;
        let alias = env.new_string(format!("inkism.storage.{id}"))?;
        let key = env
            .call_method(
                &store,
                "getKey",
                "(Ljava/lang/String;[C)Ljava/security/Key;",
                &[JValue::Object(&alias), JValue::Object(&JObject::null())],
            )?
            .l()?;
        if key.is_null() {
            return Err("mobile storage key is missing; library remains closed".into());
        }
        let algorithm = env.new_string("HmacSHA256")?;
        let mac = env
            .call_static_method(
                "javax/crypto/Mac",
                "getInstance",
                "(Ljava/lang/String;)Ljavax/crypto/Mac;",
                &[JValue::Object(&algorithm)],
            )?
            .l()?;
        env.call_method(
            &mac,
            "init",
            "(Ljava/security/Key;)V",
            &[JValue::Object(&key)],
        )?;
        let input = env.byte_array_from_slice(b"Inkism local SQLCipher storage key v1")?;
        let bytes = env
            .call_method(&mac, "doFinal", "([B)[B", &[JValue::Object(&input)])?
            .l()?;
        Ok(env.convert_byte_array(JByteArray::from(bytes))?)
    })
}
