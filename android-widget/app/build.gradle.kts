plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.itaminegai.cardwidget"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.itaminegai.cardwidget"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    signingConfigs {
        // 個人インストール用の固定キー。毎回同じ鍵で署名されるので、
        // 新しいAPKを上書きインストールしても進捗（カードの順番）が保持されます。
        create("sideload") {
            storeFile = file("../signing/sideload.keystore")
            storePassword = "itaminegai"
            keyAlias = "sideload"
            keyPassword = "itaminegai"
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("sideload")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("sideload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}
